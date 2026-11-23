using Microsoft.EntityFrameworkCore;

namespace Interlinearizer.Crdt.Tests;

/// <summary>
/// The repository over a small analysis: "and" linked in Genesis and Exodus, "beginning" in
/// Genesis, a phrase "in the" in Genesis, a segment analysis in Exodus and a payload nothing
/// links.
/// </summary>
public class AnalysisRepositoryTests : CrdtTestBase
{
    private static readonly Guid TaAnd = Guid.NewGuid();
    private static readonly Guid TaBeginning = Guid.NewGuid();
    private static readonly Guid TaUnlinked = Guid.NewGuid();
    private static readonly Guid TlGenAnd = Guid.NewGuid();
    private static readonly Guid TlExoAnd = Guid.NewGuid();
    private static readonly Guid TlGenBeginning = Guid.NewGuid();
    private static readonly Guid PaInThe = Guid.NewGuid();
    private static readonly Guid PlInThe = Guid.NewGuid();
    private static readonly Guid SaExo = Guid.NewGuid();
    private static readonly Guid SlExo = Guid.NewGuid();

    private static TokenAnalysis Token(Guid id, string surfaceText, string gloss) => new()
    {
        Id = id,
        SurfaceText = surfaceText,
        Gloss = new MultiString { ["en"] = gloss },
    };

    private static TokenAnalysis Tagged(TokenAnalysis analysis, string pos) => new()
    {
        Id = analysis.Id,
        SurfaceText = analysis.SurfaceText,
        Gloss = analysis.Gloss,
        Pos = pos,
    };

    private static TokenAnalysisLink TokenLink(Guid id, Guid analysisId, string tokenRef, string surfaceText,
        AssignmentStatus status = AssignmentStatus.Approved) => new()
        {
            Id = id,
            AnalysisId = analysisId,
            Token = new TokenSnapshot(tokenRef, surfaceText),
            Status = status,
        };

    private static ChangeSet FullAnalysis() => new()
    {
        Intent = "seed",
        TokenAnalyses = RecordChanges<TokenAnalysis>.Create(
            Token(TaAnd, "and", "and"),
            Token(TaBeginning, "beginning", "start"),
            Token(TaUnlinked, "spare", "spare")),
        TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(
            TokenLink(TlGenAnd, TaAnd, "GEN 1:1:0", "and"),
            TokenLink(TlExoAnd, TaAnd, "EXO 1:1:0", "and"),
            TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:9", "beginning", AssignmentStatus.Suggested)),
        PhraseAnalyses = RecordChanges<PhraseAnalysis>.Create(new PhraseAnalysis
        {
            Id = PaInThe,
            SurfaceText = "in the",
            Gloss = new MultiString { ["en"] = "in" },
        }),
        PhraseAnalysisLinks = RecordChanges<PhraseAnalysisLink>.Create(new PhraseAnalysisLink
        {
            Id = PlInThe,
            AnalysisId = PaInThe,
            Tokens = [new TokenSnapshot("GEN 1:1:4", "the"), new TokenSnapshot("GEN 1:1:2", "in")],
            Status = AssignmentStatus.Approved,
        }),
        SegmentAnalyses = RecordChanges<SegmentAnalysis>.Create(new SegmentAnalysis
        {
            Id = SaExo,
            SurfaceText = "And these",
            FreeTranslation = new MultiString { ["en"] = "And these are the names." },
        }),
        SegmentAnalysisLinks = RecordChanges<SegmentAnalysisLink>.Create(new SegmentAnalysisLink
        {
            Id = SlExo,
            AnalysisId = SaExo,
            SegmentId = "EXO 1:1",
            Status = AssignmentStatus.Approved,
        }),
    };

    /// <summary>The commit made last; the commit's time is not a mapped column, so it is picked in memory.</summary>
    private async Task<Commit> LatestCommit() => (await DbContext.Commits.ToListAsync()).MaxBy(c => c.DateTime)!;

    private static IEnumerable<Guid> IdsOf(IEnumerable<Analysis> records) => records.Select(r => r.Id);
    private static IEnumerable<Guid> IdsOf(IEnumerable<AnalysisLink> records) => records.Select(r => r.Id);

    private static ChangeSet EmptyMaps(Guid tokenId, Guid phraseId, Guid segmentId) => new()
    {
        Intent = "empty maps",
        TokenAnalyses = RecordChanges<TokenAnalysis>.Create(new TokenAnalysis { Id = tokenId, SurfaceText = "and", Gloss = new(), Features = new() }),
        PhraseAnalyses = RecordChanges<PhraseAnalysis>.Create(new PhraseAnalysis { Id = phraseId, SurfaceText = "in the", Gloss = new() }),
        SegmentAnalyses = RecordChanges<SegmentAnalysis>.Create(new SegmentAnalysis
        {
            Id = segmentId,
            SurfaceText = "And these",
            FreeTranslation = new(),
            LiteralTranslation = new(),
        }),
    };

    private async Task AssertMapsAbsent(Guid tokenId, Guid phraseId, Guid segmentId)
    {
        var token = (await Repository.GetTokenAnalyses([tokenId])).Single();
        await Assert.That(token.Gloss).IsNull();
        await Assert.That(token.Features).IsNull();
        await Assert.That((await Repository.GetPhraseAnalyses([phraseId])).Single().Gloss).IsNull();
        var segment = (await Repository.GetSegmentAnalyses([segmentId])).Single();
        await Assert.That(segment.FreeTranslation).IsNull();
        await Assert.That(segment.LiteralTranslation).IsNull();
    }

    [Test]
    public async Task ApplyPutsNewRecordsOfEveryKind()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(IdsOf(await Repository.GetTokenAnalyses([TaAnd, TaBeginning, TaUnlinked])))
            .IsEquivalentTo([TaAnd, TaBeginning, TaUnlinked]);
        await Assert.That(IdsOf(await Repository.GetPhraseAnalyses([PaInThe]))).IsEquivalentTo([PaInThe]);
        await Assert.That(IdsOf(await Repository.GetSegmentAnalyses([SaExo]))).IsEquivalentTo([SaExo]);
        await Assert.That(IdsOf(await Repository.GetPhraseAnalysisLinks([PlInThe]))).IsEquivalentTo([PlInThe]);
        await Assert.That(await DbContext.TokenAnalysisLinks.CountAsync()).IsEqualTo(3);
        await Assert.That(await DbContext.SegmentAnalysisLinks.CountAsync()).IsEqualTo(1);
    }

    [Test]
    public async Task ApplyStampsCreatedRecordsWithTheCommitTime()
    {
        await ApplyNext(FullAnalysis());

        var commit = await LatestCommit();
        var analysis = (await Repository.GetTokenAnalyses([TaAnd])).Single();
        await Assert.That(analysis.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(commit.DateTime);
    }

    [Test]
    public async Task ApplyClearsAFieldThatAnUpdateDrops()
    {
        await ApplyNext(FullAnalysis());
        var bare = new TokenAnalysis { Id = TaBeginning, SurfaceText = "beginning" };

        await ApplyNext(new ChangeSet
        {
            Intent = "clear",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(Token(TaBeginning, "beginning", "start"), bare)),
        });

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.Gloss).IsNull();
        await Assert.That(stored.SurfaceText).IsEqualTo("beginning");
        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(3);
    }

    [Test]
    public async Task ApplyWritesOnlyWhatDiffersBetweenAnUpdatesBeforeAndAfter()
    {
        await ApplyNext(FullAnalysis());
        var put = new TokenAnalysis
        {
            Id = TaBeginning,
            SurfaceText = "Beginning",
            Gloss = new MultiString { ["en"] = "start", ["fr"] = "début" },
        };

        await ApplyNext(new ChangeSet
        {
            Intent = "patch",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(Token(TaBeginning, "beginning", "start"), put)),
        });

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.SurfaceText).IsEqualTo("Beginning");
        await Assert.That(stored.Gloss).IsEquivalentTo(put.Gloss);
        var changes = await DbContext.ChangeEntities.ToListAsync();
        var patch = changes.Select(c => c.Change).OfType<PatchTokenAnalysisChange>().Single();
        await Assert.That(patch.SurfaceText.HasValue).IsTrue();
        await Assert.That(patch.Gloss).IsEquivalentTo(new Dictionary<string, string?> { ["fr"] = "début" });
        await Assert.That(patch.Confidence.HasValue).IsFalse();
        await Assert.That(patch.Producer.HasValue).IsFalse();
        await Assert.That(patch.Morphemes.HasValue).IsFalse();
        await Assert.That(patch.Pos.HasValue).IsFalse();
        await Assert.That(patch.Features).IsNull();
    }

    [Test]
    public async Task ApplyKeepsAFieldThatAnUpdateLeavesAloneThoughAnotherCommitChangedItAfterTheRead()
    {
        await ApplyNext(FullAnalysis());
        var read = Token(TaBeginning, "beginning", "start");
        await ApplyNext(new ChangeSet
        {
            Intent = "tag",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(read, Tagged(read, "N"))),
        });

        await ApplyNext(new ChangeSet
        {
            Intent = "gloss",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(read, Token(TaBeginning, "beginning", "origin"))),
        });

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.Pos).IsEqualTo("N");
        await Assert.That(stored.Gloss!["en"]).IsEqualTo("origin");
    }

    [Test]
    public async Task ApplyKeepsBothFieldsOfCommitsThatChangeDifferentFieldsWhenTheEarlierArrivesLater()
    {
        await ApplyNext(FullAnalysis());
        var read = Token(TaBeginning, "beginning", "start");
        var earlier = NextDate();
        await ApplyNext(new ChangeSet
        {
            Intent = "gloss",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(read, Token(TaBeginning, "beginning", "origin"))),
        });

        await ApplyAt(earlier, new ChangeSet
        {
            Intent = "tag",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(read, Tagged(read, "N"))),
        });

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.Pos).IsEqualTo("N");
        await Assert.That(stored.Gloss!["en"]).IsEqualTo("origin");
    }

    [Test]
    public async Task ApplyStoresACreatedEmptyMapAsAbsent()
    {
        var (tokenId, phraseId, segmentId) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        await ApplyNext(EmptyMaps(tokenId, phraseId, segmentId));

        await AssertMapsAbsent(tokenId, phraseId, segmentId);
    }

    [Test]
    public async Task ApplyStoresAnEmptyMapReplacingAFullOneAsAbsent()
    {
        await ApplyNext(FullAnalysis());

        var full = FullAnalysis();
        var empty = EmptyMaps(TaBeginning, PaInThe, SaExo);

        await ApplyNext(new ChangeSet
        {
            Intent = "empty maps",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(
                full.TokenAnalyses!.Creates.Single(a => a.Id == TaBeginning), empty.TokenAnalyses!.Creates.Single())),
            PhraseAnalyses = RecordChanges<PhraseAnalysis>.Update(new RecordUpdate<PhraseAnalysis>(
                full.PhraseAnalyses!.Creates.Single(), empty.PhraseAnalyses!.Creates.Single())),
            SegmentAnalyses = RecordChanges<SegmentAnalysis>.Update(new RecordUpdate<SegmentAnalysis>(
                full.SegmentAnalyses!.Creates.Single(), empty.SegmentAnalyses!.Creates.Single())),
        });

        await AssertMapsAbsent(TaBeginning, PaInThe, SaExo);
    }

    [Test]
    public async Task ApplyWritesNothingForAnUpdateWhoseBeforeAndAfterAgree()
    {
        await ApplyNext(FullAnalysis());
        var read = Token(TaBeginning, "beginning", "earlier");

        await ApplyNext(new ChangeSet { Intent = "noop", TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(read, read)) });

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(2);
    }

    [Test]
    public async Task ApplyComparesMorphemesByContent()
    {
        var analysisId = Guid.NewGuid();
        await WriteNextChange(Fixtures.CreateTokenAnalysis(analysisId));
        var stored = (await Repository.GetTokenAnalyses([analysisId])).Single();
        var put = new TokenAnalysis
        {
            Id = analysisId,
            SurfaceText = stored.SurfaceText,
            Confidence = stored.Confidence,
            Producer = stored.Producer,
            // Fresh instances with the same content, as a put read from the wire would carry.
            Morphemes = stored.Morphemes!.Select(m => m with { Gloss = m.Gloss?.Copy() }).ToList(),
            MorphemesStale = stored.MorphemesStale,
            Pos = "N",
            Features = new Dictionary<string, string>(stored.Features!),
            Gloss = stored.Gloss!.Copy(),
            GlossSenseRef = stored.GlossSenseRef,
        };

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(stored, put)) });

        var changes = await DbContext.ChangeEntities.ToListAsync();
        var patch = changes.Select(c => c.Change).OfType<PatchTokenAnalysisChange>().Single();
        await Assert.That(patch.Pos.HasValue).IsTrue();
        await Assert.That(patch.Morphemes.HasValue).IsFalse();
        await Assert.That(patch.Features).IsNull();
        await Assert.That(patch.Gloss).IsNull();
        await Assert.That(patch.GlossSenseRef.HasValue).IsFalse();
    }

    [Test]
    public async Task ApplySkipsAnUpdateOfARecordNotStored()
    {
        var fresh = Guid.NewGuid();

        var reply = await ApplyNext(new ChangeSet
        {
            Intent = "patch",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(Token(fresh, "new", "new"), Token(fresh, "new", "newer"))),
        });

        await Assert.That(reply.TokenAnalyses).IsNull();
        await Assert.That(await Repository.GetTokenAnalyses([fresh])).IsEmpty();
    }

    [Test]
    public async Task ApplyRefusesACreateOfAStoredRecordApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "createStored",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(TaAnd, "and", "also")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
    }

    [Test]
    public async Task ApplyRefusesAnUpdateWhoseBeforeAndAfterNameDifferentRecords()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "mismatched",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(Token(TaBeginning, "beginning", "start"), Token(TaAnd, "and", "also"))),
        })).Throws<ArgumentException>();
    }

    [Test]
    public async Task ApplyKeepsTheCreationTimeOfAnUpdatedRecord()
    {
        await ApplyNext(FullAnalysis());
        var created = await LatestCommit();

        await ApplyNext(new ChangeSet
        {
            Intent = "update",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(Token(TaAnd, "and", "and"), Token(TaAnd, "and", "also"))),
        });

        var stored = (await Repository.GetTokenAnalyses([TaAnd])).Single();
        await Assert.That(stored.CreatedAt).IsEqualTo(created.DateTime);
        await Assert.That(stored.UpdatedAt).IsNotEqualTo(created.DateTime);
    }

    [Test]
    public async Task ApplyDeletesRecordsOfEveryKind()
    {
        await ApplyNext(FullAnalysis());

        await ApplyNext(new ChangeSet
        {
            Intent = "deleteExodus",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Delete(TlExoAnd),
            SegmentAnalyses = RecordChanges<SegmentAnalysis>.Delete(SaExo),
            SegmentAnalysisLinks = RecordChanges<SegmentAnalysisLink>.Delete(SlExo),
        });

        await Assert.That(await Repository.GetSegmentAnalyses([SaExo])).IsEmpty();
        await Assert.That(await Repository.FindLinksBySegment(["EXO 1:1"])).IsEmpty();
        await Assert.That(IdsOf(await Repository.FindLinksToAnalyses([TaAnd]).ContinueWith(t => t.Result.TokenAnalysisLinks)))
            .IsEquivalentTo([TlGenAnd]);
    }

    [Test]
    public async Task ApplyRecreatesADeletedRecordThatIsCreatedAgain()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked) });

        await ApplyNext(new ChangeSet { Intent = "restore", TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(TaUnlinked, "spare", "spare")) });

        var stored = (await Repository.GetTokenAnalyses([TaUnlinked])).Single();
        await Assert.That(stored.DeletedAt).IsNull();
    }

    [Test]
    public async Task ApplySkipsADeleteOfARecordNotStored()
    {
        await ApplyNext(FullAnalysis());

        await ApplyNext(new ChangeSet { Intent = "deleteMissing", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(Guid.NewGuid()) });

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(2);
        await Assert.That(await DbContext.TokenAnalyses.CountAsync()).IsEqualTo(3);
    }

    [Test]
    public async Task ApplyRecordsTheIntentOnTheCommit()
    {
        await ApplyNext(FullAnalysis());

        var commit = await LatestCommit();
        await Assert.That(commit.Metadata[AnalysisRepository.IntentMetadataKey]).IsEqualTo("seed");
    }

    [Test]
    public async Task ApplyReportsTheLinksADeletedAnalysisTookWithIt()
    {
        await ApplyNext(FullAnalysis());

        var reply = await ApplyNext(new ChangeSet { Intent = "deleteAnd", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaAnd) });

        await Assert.That(reply.Intent).IsEqualTo("deleteAnd");
        await Assert.That(reply.TokenAnalyses!.Deletes).IsEquivalentTo([TaAnd]);
        await Assert.That(reply.TokenAnalysisLinks!.Deletes).IsEquivalentTo([TlGenAnd, TlExoAnd]);
        await Assert.That(reply.TokenAnalysisLinks.Puts).IsEmpty();
    }

    [Test]
    public async Task ApplyLeavesALinkDeletedEarlierOutOfWhatItReports()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "deleteLink", TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Delete(TlExoAnd) });

        var reply = await ApplyNext(new ChangeSet { Intent = "deleteAnd", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaAnd) });

        await Assert.That(reply.TokenAnalysisLinks!.Deletes).IsEquivalentTo([TlGenAnd]);
    }

    [Test]
    public async Task ApplyReportsEachPutAsStored()
    {
        var reply = await ApplyNext(FullAnalysis());

        var commit = await LatestCommit();
        var put = reply.TokenAnalyses!.Puts.Single(a => a.Id == TaAnd);
        await Assert.That(put.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(put.ProjectId).IsEqualTo(ProjectId);
        await Assert.That(IdsOf(reply.TokenAnalysisLinks!.Puts)).IsEquivalentTo([TlGenAnd, TlExoAnd, TlGenBeginning]);
    }

    [Test]
    public async Task ApplyReportsNoChangeForADeleteOfARecordNotStored()
    {
        await ApplyNext(FullAnalysis());

        var reply = await ApplyNext(new ChangeSet { Intent = "deleteMissing", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(Guid.NewGuid()) });

        await Assert.That(reply).IsEqualTo(new AppliedChangeSet { Intent = "deleteMissing" });
    }

    [Test]
    public async Task ApplyRefusesAnIdNamedTwiceInOneKindApplyingNothing()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "conflicting",
            TokenAnalyses = new RecordChanges<TokenAnalysis>(
                [],
                [new RecordUpdate<TokenAnalysis>(Token(TaAnd, "and", "and"), Token(TaAnd, "and", "also"))],
                [new DeletedRecord(TaAnd)]),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(2);
        var stored = (await Repository.GetTokenAnalyses([TaAnd])).Single();
        await Assert.That(stored.Gloss!["en"]).IsEqualTo("and");
    }

    [Test]
    public async Task GetsEachPayloadKindByIdOncePerIdSkippingIdsWithNothingStored()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(IdsOf(await Repository.GetTokenAnalyses([TaAnd, Guid.NewGuid(), TaAnd]))).IsEquivalentTo([TaAnd]);
        await Assert.That(IdsOf(await Repository.GetSegmentAnalyses([SaExo, Guid.NewGuid()]))).IsEquivalentTo([SaExo]);
        await Assert.That(IdsOf(await Repository.GetPhraseAnalysisLinks([PlInThe, Guid.NewGuid(), PlInThe]))).IsEquivalentTo([PlInThe]);
    }

    [Test]
    public async Task FindsTheTokenLinksOnTokensAndThePhraseLinksTouchingThemEachOnce()
    {
        await ApplyNext(FullAnalysis());

        var links = await Repository.FindLinksByToken(["GEN 1:1:0", "GEN 1:1:2", "GEN 1:1:4"]);

        await Assert.That(IdsOf(links.TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd]);
        await Assert.That(IdsOf(links.PhraseAnalysisLinks)).IsEquivalentTo([PlInThe]);
    }

    [Test]
    public async Task FindsTheSegmentLinksOnSegments()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(IdsOf(await Repository.FindLinksBySegment(["EXO 1:1", "GEN 1:1"]))).IsEquivalentTo([SlExo]);
    }

    [Test]
    public async Task FindsTheLinksOfEveryKindToAnalyses()
    {
        await ApplyNext(FullAnalysis());

        var links = await Repository.FindLinksToAnalyses([TaAnd, PaInThe, SaExo]);

        await Assert.That(IdsOf(links.TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd, TlExoAnd]);
        await Assert.That(IdsOf(links.PhraseAnalysisLinks)).IsEquivalentTo([PlInThe]);
        await Assert.That(IdsOf(links.SegmentAnalysisLinks)).IsEquivalentTo([SlExo]);
    }

    [Test]
    public async Task FindsTheLinksOfEveryKindIntoBooks()
    {
        await ApplyNext(FullAnalysis());

        var links = await Repository.FindLinksInBooks(["GEN"]);

        await Assert.That(IdsOf(links.TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd, TlGenBeginning]);
        await Assert.That(IdsOf(links.PhraseAnalysisLinks)).IsEquivalentTo([PlInThe]);
        await Assert.That(links.SegmentAnalysisLinks).IsEmpty();
    }

    [Test]
    public async Task FindsTheLinksIntoBooksWithTheStatusesAskedFor()
    {
        await ApplyNext(FullAnalysis());

        var links = await Repository.FindLinksInBooks(["GEN", "EXO"], [AssignmentStatus.Suggested]);

        await Assert.That(IdsOf(links.TokenAnalysisLinks)).IsEquivalentTo([TlGenBeginning]);
        await Assert.That(links.PhraseAnalysisLinks).IsEmpty();
        await Assert.That(links.SegmentAnalysisLinks).IsEmpty();
    }

    [Test]
    public async Task FindsTheBooksTheLinksPointIntoEachOnce()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(await Repository.FindLinkedBooks()).IsEquivalentTo(["EXO", "GEN"]);
    }

    [Test]
    public async Task FindsABookOnlyAPhraseOrSegmentLinkPointsInto()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet
        {
            Intent = "unlinkTokens",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Delete(TlGenAnd, TlExoAnd, TlGenBeginning),
        });

        await Assert.That(await Repository.FindLinkedBooks()).IsEquivalentTo(["EXO", "GEN"]);
    }

    [Test]
    public async Task FindsALinkedBookWhoseCodeIsOutsideTheCanon()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet
        {
            Intent = "linkOutsideCanon",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(Guid.NewGuid(), TaAnd, "ZZZ front1:0", "and")),
        });

        await Assert.That(await Repository.FindLinkedBooks()).IsEquivalentTo(["EXO", "GEN", "ZZZ"]);
    }

    [Test]
    public async Task DropsABookOnceNoLinkPointsIntoIt()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet
        {
            Intent = "unlinkExodus",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Delete(TlExoAnd),
            SegmentAnalysisLinks = RecordChanges<SegmentAnalysisLink>.Delete(SlExo),
        });

        await Assert.That(await Repository.FindLinkedBooks()).IsEquivalentTo(["GEN"]);
    }

    [Test]
    public async Task FindsNoLinkedBooksBeforeAnythingIsStored()
    {
        await Assert.That(await Repository.FindLinkedBooks()).IsEmpty();
    }

    [Test]
    public async Task FindsThePayloadsWhoseSurfaceTextNormalizesToAForm()
    {
        await ApplyNext(FullAnalysis());
        var capitalized = Guid.NewGuid();
        await ApplyNext(new ChangeSet
        {
            Intent = "addCapitalized",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(capitalized, "And", "and")),
        });

        await Assert.That(IdsOf(await Repository.FindTokenAnalysesByForm([Refs.NormalizeSurfaceForm("AND")])))
            .IsEquivalentTo([TaAnd, capitalized]);
        await Assert.That(IdsOf(await Repository.FindPhraseAnalysesByForm([Refs.NormalizeSurfaceForm("In The")])))
            .IsEquivalentTo([PaInThe]);
    }

    /// <summary>
    /// Harmony's behavior, which the repository's refusals below guard against: a second create
    /// under an id already created, of whatever kind, is dropped without error.
    /// </summary>
    [Test]
    public async Task HarmonyKeepsOneEntityPerIdWhateverItsKind()
    {
        var shared = Guid.NewGuid();
        var createAnalysis = new CreatePhraseAnalysisChange(shared) { ProjectId = ProjectId, SurfaceText = "in" };
        var createLink = new CreatePhraseAnalysisLinkChange(shared)
        {
            ProjectId = ProjectId,
            AnalysisId = shared,
            Tokens = [new TokenSnapshot("GEN 1:1:2", "in")],
            Status = AssignmentStatus.Approved,
        };

        await WriteNextChange([createAnalysis, createLink]);

        await Assert.That(await DbContext.PhraseAnalyses.CountAsync()).IsEqualTo(1);
        await Assert.That(await DbContext.PhraseAnalysisLinks.CountAsync()).IsEqualTo(0);
    }

    [Test]
    public async Task ApplyRefusesAnIdSharedAcrossKindsApplyingNothing()
    {
        var shared = Guid.NewGuid();
        var link = new PhraseAnalysisLink
        {
            Id = shared,
            AnalysisId = shared,
            Tokens = [new TokenSnapshot("GEN 1:1:2", "in")],
            Status = AssignmentStatus.Approved,
        };

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "shared id",
            PhraseAnalyses = RecordChanges<PhraseAnalysis>.Create(new PhraseAnalysis { Id = shared, SurfaceText = "in" }),
            PhraseAnalysisLinks = RecordChanges<PhraseAnalysisLink>.Create(link),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(1);
    }

    [Test]
    public async Task ApplyRefusesAPutUnderAnIdStoredAsAnotherKindApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        var link = new PhraseAnalysisLink
        {
            Id = PaInThe,
            AnalysisId = PaInThe,
            Tokens = [new TokenSnapshot("GEN 1:1:2", "in")],
            Status = AssignmentStatus.Approved,
        };

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "stored as another kind",
            PhraseAnalysisLinks = RecordChanges<PhraseAnalysisLink>.Create(link),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(2);
        await Assert.That(IdsOf(await Repository.GetPhraseAnalyses([PaInThe]))).IsEquivalentTo([PaInThe]);
    }

    private static readonly Guid OtherProjectId = Guid.NewGuid();

    /// <summary>
    /// A repository over a second project in the same database, holding "and" on GEN 1:1:0 too,
    /// under ids of its own.
    /// </summary>
    private async Task<(AnalysisRepository Repository, Guid TaAnd, Guid TlGenAnd)> OtherProject()
    {
        await CreateProject(OtherProjectId);
        var other = RepositoryFor(OtherProjectId);
        var taAnd = Guid.NewGuid();
        var tlGenAnd = Guid.NewGuid();
        await other.Apply(new ChangeSet
        {
            Intent = "seed other",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(taAnd, "and", "also")),
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(tlGenAnd, taAnd, "GEN 1:1:0", "and")),
        });
        return (other, taAnd, tlGenAnd);
    }

    [Test]
    public async Task ApplyRefusesALinkNamingAnotherProjectsAnalysisApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        var (other, _, _) = await OtherProject();
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await other.Apply(new ChangeSet
        {
            Intent = "borrow",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(Guid.NewGuid(), TaAnd, "GEN 1:1:9", "beginning")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
    }

    [Test]
    public async Task ApplyRefusesALinkNamingAnAnalysisNeverStoredApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "link to nothing",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(Guid.NewGuid(), Guid.NewGuid(), "GEN 1:1:9", "beginning")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
    }

    [Test]
    public async Task ApplyRefusesALinkNamingADeletedAnalysisApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked) });
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "link to deleted",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(Guid.NewGuid(), TaUnlinked, "GEN 1:1:9", "beginning")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
    }

    [Test]
    public async Task ApplyRefusesALinkNamingAnAnalysisTheSameChangesDeleteApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "link and delete",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked),
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(Guid.NewGuid(), TaUnlinked, "GEN 1:1:9", "beginning")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
    }

    [Test]
    public async Task ApplyRefusesAPutUnderAnIdDeletedAsAnotherKindApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked) });
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "reuse as another kind",
            PhraseAnalyses = RecordChanges<PhraseAnalysis>.Create(new PhraseAnalysis { Id = TaUnlinked, SurfaceText = "in the" }),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
        await Assert.That(await Repository.GetPhraseAnalyses([TaUnlinked])).IsEmpty();
    }

    [Test]
    public async Task ApplyRefusesAPutUnderAnIdDeletedInAnotherProjectApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked) });
        var (other, _, _) = await OtherProject();
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await other.Apply(new ChangeSet
        {
            Intent = "reuse in another project",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(TaUnlinked, "spare", "spare")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
        await Assert.That(await other.GetTokenAnalyses([TaUnlinked])).IsEmpty();
    }

    [Test]
    public async Task ApplyStampsCreatedRecordsWithTheProject()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That((await Repository.GetTokenAnalyses([TaAnd])).Single().ProjectId).IsEqualTo(ProjectId);
        await Assert.That((await Repository.FindLinksToAnalyses([TaAnd])).TokenAnalysisLinks.Select(l => l.ProjectId).Distinct())
            .IsEquivalentTo([ProjectId]);
    }

    [Test]
    public async Task KeepsTheRecordsOfTwoProjectsInOneDatabaseApart()
    {
        await ApplyNext(FullAnalysis());
        var (other, otherTaAnd, otherTlGenAnd) = await OtherProject();

        await Assert.That(IdsOf(await other.GetTokenAnalyses([TaAnd, otherTaAnd]))).IsEquivalentTo([otherTaAnd]);
        await Assert.That(IdsOf(await Repository.GetTokenAnalyses([TaAnd, otherTaAnd]))).IsEquivalentTo([TaAnd]);
        await Assert.That(IdsOf((await other.FindLinksByToken(["GEN 1:1:0"])).TokenAnalysisLinks)).IsEquivalentTo([otherTlGenAnd]);
        await Assert.That(IdsOf((await Repository.FindLinksByToken(["GEN 1:1:0"])).TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd]);
        await Assert.That(IdsOf(await other.FindTokenAnalysesByForm(["and"]))).IsEquivalentTo([otherTaAnd]);
        await Assert.That(IdsOf((await other.FindLinksInBooks(["GEN", "EXO"])).TokenAnalysisLinks)).IsEquivalentTo([otherTlGenAnd]);
        await Assert.That(await other.FindLinkedBooks()).IsEquivalentTo(["GEN"]);
        await Assert.That(await other.CountApprovals([TaAnd, otherTaAnd])).IsEquivalentTo(new Dictionary<Guid, int> { [otherTaAnd] = 1 });
        await Assert.That(await Repository.CountApprovals([TaAnd])).IsEquivalentTo(new Dictionary<Guid, int> { [TaAnd] = 2 });
        await Assert.That(IdsOf((await other.ReadAll()).TokenAnalyses)).IsEquivalentTo([otherTaAnd]);
    }

    [Test]
    public async Task ApplyRefusesAPutUnderAnIdStoredInAnotherProjectApplyingNothing()
    {
        await ApplyNext(FullAnalysis());
        var (other, _, _) = await OtherProject();
        var commits = await DbContext.Commits.CountAsync();

        await Assert.That(async () => await other.Apply(new ChangeSet
        {
            Intent = "steal",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(TaAnd, "and", "stolen")),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
        await Assert.That((await Repository.GetTokenAnalyses([TaAnd])).Single().Gloss!["en"]).IsEqualTo("and");
    }

    [Test]
    public async Task ApplySkipsADeleteOfAnotherProjectsRecord()
    {
        await ApplyNext(FullAnalysis());
        var (other, _, _) = await OtherProject();
        var commits = await DbContext.Commits.CountAsync();

        await other.Apply(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaAnd) });

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
        await Assert.That(IdsOf(await Repository.GetTokenAnalyses([TaAnd]))).IsEquivalentTo([TaAnd]);
    }

    [Test]
    public async Task ApplyRefusesAPutNamingAnotherProject()
    {
        var put = new TokenAnalysis { Id = Guid.NewGuid(), ProjectId = OtherProjectId, SurfaceText = "and" };

        await Assert.That(async () => await ApplyNext(new ChangeSet { Intent = "misfiled", TokenAnalyses = RecordChanges<TokenAnalysis>.Create(put) }))
            .Throws<ArgumentException>();

        await Assert.That(await DbContext.TokenAnalyses.CountAsync()).IsEqualTo(0);
    }

    [Test]
    public async Task ApplyRefusesAnUpdateOfAStoredRecordNamingAnotherProject()
    {
        await ApplyNext(FullAnalysis());
        var commits = await DbContext.Commits.CountAsync();
        var put = new TokenAnalysis
        {
            Id = TaAnd,
            ProjectId = OtherProjectId,
            SurfaceText = "and",
            Gloss = new MultiString { ["en"] = "misfiled" },
        };

        await Assert.That(async () => await ApplyNext(new ChangeSet
        {
            Intent = "misfiled",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(Token(TaAnd, "and", "and"), put)),
        }))
            .Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(commits);
        await Assert.That((await Repository.GetTokenAnalyses([TaAnd])).Single().Gloss!["en"]).IsEqualTo("and");
    }

    [Test]
    public async Task ReadsEveryStoredRecord()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked) });

        var all = await Repository.ReadAll();

        await Assert.That(IdsOf(all.TokenAnalyses)).IsEquivalentTo([TaAnd, TaBeginning]);
        await Assert.That(IdsOf(all.TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd, TlExoAnd, TlGenBeginning]);
        await Assert.That(IdsOf(all.PhraseAnalyses)).IsEquivalentTo([PaInThe]);
        await Assert.That(IdsOf(all.PhraseAnalysisLinks)).IsEquivalentTo([PlInThe]);
        await Assert.That(IdsOf(all.SegmentAnalyses)).IsEquivalentTo([SaExo]);
        await Assert.That(IdsOf(all.SegmentAnalysisLinks)).IsEquivalentTo([SlExo]);
    }

    [Test]
    public async Task CountsTheTokensApprovingEachAnalysisLeavingOutThoseNoneApproves()
    {
        await ApplyNext(FullAnalysis());

        var counts = await Repository.CountApprovals([TaAnd, TaBeginning, TaUnlinked, Guid.NewGuid()]);

        await Assert.That(counts).IsEquivalentTo(new Dictionary<Guid, int> { [TaAnd] = 2 });
    }

    [Test]
    public async Task CountsATokenOnceForTheApprovedLinkAnApprovalTiePicks()
    {
        await ApplyNext(FullAnalysis());
        // A later commit, so the moved link's update wins the tie on GEN 1:1:0.
        await ApplyNext(new ChangeSet
        {
            Intent = "approveTwice",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Update(new RecordUpdate<TokenAnalysisLink>(
                TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:9", "beginning", AssignmentStatus.Suggested),
                TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:0", "and"))),
        });

        var counts = await Repository.CountApprovals([TaAnd, TaBeginning]);

        await Assert.That(counts).IsEquivalentTo(new Dictionary<Guid, int> { [TaAnd] = 1, [TaBeginning] = 1 });
    }

    [Test]
    public async Task PicksTheSmallerIdAmongApprovedLinksUpdatedTogether()
    {
        var smaller = Guid.Parse("00000000-0000-4000-8000-000000000001");
        var larger = Guid.Parse("00000000-0000-4000-8000-000000000002");
        await ApplyNext(new ChangeSet
        {
            Intent = "approveTwice",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Create(Token(TaAnd, "and", "and"), Token(TaBeginning, "and", "also")),
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(
                TokenLink(larger, TaAnd, "GEN 1:1:0", "and"),
                TokenLink(smaller, TaBeginning, "GEN 1:1:0", "and")),
        });

        var counts = await Repository.CountApprovals([TaAnd, TaBeginning]);

        await Assert.That(counts).IsEquivalentTo(new Dictionary<Guid, int> { [TaBeginning] = 1 });
    }

    [Test]
    public async Task PassesOverAnApprovedLinkNamingNoStoredTokenPayloadWhenPickingATie()
    {
        await ApplyNext(FullAnalysis());
        var phraseNamed = Guid.NewGuid();
        // A link naming no stored record at all lands deleted, so this one names a phrase payload.
        await ApplyNext(new ChangeSet
        {
            Intent = "approvePhrasePayload",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Create(TokenLink(phraseNamed, PaInThe, "GEN 1:1:0", "and")),
        });
        await Assert.That(IdsOf((await Repository.FindLinksByToken(["GEN 1:1:0"])).TokenAnalysisLinks)).Contains(phraseNamed);

        var counts = await Repository.CountApprovals([TaAnd]);

        await Assert.That(counts).IsEquivalentTo(new Dictionary<Guid, int> { [TaAnd] = 2 });
    }

    [Test]
    public async Task FindsTheApprovalsFiledUnderEachFormLeavingOutThoseWithNone()
    {
        await ApplyNext(FullAnalysis());

        var approvals = await Repository.FindApprovalsByForm(["and", "beginning", "missing"]);

        await Assert.That(approvals.Keys).IsEquivalentTo(["and"]);
        await Assert.That(approvals["and"]).IsEquivalentTo(new Dictionary<string, Guid> { ["GEN 1:1:0"] = TaAnd, ["EXO 1:1:0"] = TaAnd });
    }

    [Test]
    public async Task FilesATokenOnceUnderTheApprovedLinkAnApprovalTiePicks()
    {
        await ApplyNext(FullAnalysis());
        // A later commit, so the moved link's update wins the tie on GEN 1:1:0.
        await ApplyNext(new ChangeSet
        {
            Intent = "approveTwice",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Update(new RecordUpdate<TokenAnalysisLink>(
                TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:9", "beginning", AssignmentStatus.Suggested),
                TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:0", "Beginning"))),
        });

        var approvals = await Repository.FindApprovalsByForm(["and", "beginning"]);

        await Assert.That(approvals["and"]).IsEquivalentTo(new Dictionary<string, Guid> { ["EXO 1:1:0"] = TaAnd });
        await Assert.That(approvals["beginning"]).IsEquivalentTo(new Dictionary<string, Guid> { ["GEN 1:1:0"] = TaBeginning });
    }

    [Test]
    public async Task FilesAnEditedRecordUnderItsNewKeysOnly()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet
        {
            Intent = "moveLink",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Update(new RecordUpdate<TokenAnalysisLink>(
                TokenLink(TlGenAnd, TaAnd, "GEN 1:1:0", "and"), TokenLink(TlGenAnd, TaBeginning, "LEV 1:1:0", "and"))),
            TokenAnalyses = RecordChanges<TokenAnalysis>.Update(new RecordUpdate<TokenAnalysis>(
                Token(TaAnd, "and", "and"), Token(TaAnd, "but", "but"))),
        });

        await Assert.That(IdsOf((await Repository.FindLinksByToken(["GEN 1:1:0"])).TokenAnalysisLinks)).IsEmpty();
        await Assert.That(IdsOf((await Repository.FindLinksByToken(["LEV 1:1:0"])).TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd]);
        await Assert.That(IdsOf((await Repository.FindLinksToAnalyses([TaAnd])).TokenAnalysisLinks)).IsEquivalentTo([TlExoAnd]);
        await Assert.That(await Repository.FindLinkedBooks()).IsEquivalentTo(["EXO", "GEN", "LEV"]);
        await Assert.That(IdsOf(await Repository.FindTokenAnalysesByForm(["and"]))).IsEmpty();
        await Assert.That(IdsOf(await Repository.FindTokenAnalysesByForm(["but"]))).IsEquivalentTo([TaAnd]);
    }
}
