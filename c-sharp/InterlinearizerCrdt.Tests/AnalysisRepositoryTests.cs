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
        TokenAnalyses = RecordChanges<TokenAnalysis>.Put(
            Token(TaAnd, "and", "and"),
            Token(TaBeginning, "beginning", "start"),
            Token(TaUnlinked, "spare", "spare")),
        TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(
            TokenLink(TlGenAnd, TaAnd, "GEN 1:1:0", "and"),
            TokenLink(TlExoAnd, TaAnd, "EXO 1:1:0", "and"),
            TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:9", "beginning", AssignmentStatus.Suggested)),
        PhraseAnalyses = RecordChanges<PhraseAnalysis>.Put(new PhraseAnalysis
        {
            Id = PaInThe,
            SurfaceText = "in the",
            Gloss = new MultiString { ["en"] = "in" },
        }),
        PhraseAnalysisLinks = RecordChanges<PhraseAnalysisLink>.Put(new PhraseAnalysisLink
        {
            Id = PlInThe,
            AnalysisId = PaInThe,
            Tokens = [new TokenSnapshot("GEN 1:1:4", "the"), new TokenSnapshot("GEN 1:1:2", "in")],
            Status = AssignmentStatus.Approved,
        }),
        SegmentAnalyses = RecordChanges<SegmentAnalysis>.Put(new SegmentAnalysis
        {
            Id = SaExo,
            SurfaceText = "And these",
            FreeTranslation = new MultiString { ["en"] = "And these are the names." },
        }),
        SegmentAnalysisLinks = RecordChanges<SegmentAnalysisLink>.Put(new SegmentAnalysisLink
        {
            Id = SlExo,
            AnalysisId = SaExo,
            SegmentId = "EXO 1:1",
            Status = AssignmentStatus.Approved,
        }),
    };

    private static IEnumerable<Guid> IdsOf(IEnumerable<Analysis> records) => records.Select(r => r.Id);
    private static IEnumerable<Guid> IdsOf(IEnumerable<AnalysisLink> records) => records.Select(r => r.Id);

    private static ChangeSet EmptyMaps(Guid tokenId, Guid phraseId, Guid segmentId) => new()
    {
        Intent = "empty maps",
        TokenAnalyses = RecordChanges<TokenAnalysis>.Put(new TokenAnalysis { Id = tokenId, SurfaceText = "and", Gloss = new(), Features = new() }),
        PhraseAnalyses = RecordChanges<PhraseAnalysis>.Put(new PhraseAnalysis { Id = phraseId, SurfaceText = "in the", Gloss = new() }),
        SegmentAnalyses = RecordChanges<SegmentAnalysis>.Put(new SegmentAnalysis
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

        var commit = await DbContext.Commits.SingleAsync();
        var analysis = (await Repository.GetTokenAnalyses([TaAnd])).Single();
        await Assert.That(analysis.CreatedAt).IsEqualTo(commit.DateTime);
        await Assert.That(analysis.UpdatedAt).IsEqualTo(commit.DateTime);
    }

    [Test]
    public async Task ApplyReplacesAStoredRecordWholeDroppingFieldsThePutLacks()
    {
        await ApplyNext(FullAnalysis());
        var bare = new TokenAnalysis { Id = TaBeginning, SurfaceText = "beginning" };

        await ApplyNext(new ChangeSet { Intent = "replace", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(bare) });

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.Gloss).IsNull();
        await Assert.That(stored.SurfaceText).IsEqualTo("beginning");
        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(2);
    }

    [Test]
    public async Task ApplyInPatchModeWritesOnlyWhatDiffersFromTheStoredRecord()
    {
        await ApplyNext(FullAnalysis());
        var put = new TokenAnalysis
        {
            Id = TaBeginning,
            SurfaceText = "Beginning",
            Gloss = new MultiString { ["en"] = "start", ["fr"] = "début" },
        };

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) }, PutMode.Patch);

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
    public async Task ApplyInPatchModeClearsWhatThePutLacks()
    {
        await ApplyNext(FullAnalysis());
        var put = new TokenAnalysis { Id = TaBeginning, SurfaceText = "beginning" };

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) }, PutMode.Patch);

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.Gloss).IsNull();
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

        await ApplyNext(EmptyMaps(TaBeginning, PaInThe, SaExo));

        await AssertMapsAbsent(TaBeginning, PaInThe, SaExo);
    }

    [Test]
    public async Task ApplyInPatchModeWritesNothingForAPutEqualToTheStoredRecord()
    {
        await ApplyNext(FullAnalysis());
        var same = Token(TaBeginning, "beginning", "start");

        await ApplyNext(new ChangeSet { Intent = "noop", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(same) }, PutMode.Patch);

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(1);
    }

    [Test]
    public async Task ApplyInPatchModeComparesMorphemesByContent()
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

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) }, PutMode.Patch);

        var changes = await DbContext.ChangeEntities.ToListAsync();
        var patch = changes.Select(c => c.Change).OfType<PatchTokenAnalysisChange>().Single();
        await Assert.That(patch.Pos.HasValue).IsTrue();
        await Assert.That(patch.Morphemes.HasValue).IsFalse();
        await Assert.That(patch.Features).IsNull();
        await Assert.That(patch.Gloss).IsNull();
        await Assert.That(patch.GlossSenseRef.HasValue).IsFalse();
    }

    [Test]
    public async Task ApplyInPatchModeStillCreatesARecordNotStored()
    {
        var fresh = Guid.NewGuid();

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(Token(fresh, "new", "new")) }, PutMode.Patch);

        await Assert.That(IdsOf(await Repository.GetTokenAnalyses([fresh]))).IsEquivalentTo([fresh]);
    }

    [Test]
    public async Task ApplyKeepsTheCreationTimeOfAReplacedRecord()
    {
        await ApplyNext(FullAnalysis());
        var created = await DbContext.Commits.SingleAsync();

        await ApplyNext(new ChangeSet
        {
            Intent = "replace",
            TokenAnalyses = RecordChanges<TokenAnalysis>.Put(Token(TaAnd, "and", "also")),
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
    public async Task ApplyRecreatesADeletedRecordThatIsPutAgain()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet { Intent = "delete", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(TaUnlinked) });

        await ApplyNext(new ChangeSet { Intent = "restore", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(Token(TaUnlinked, "spare", "spare")) });

        var stored = (await Repository.GetTokenAnalyses([TaUnlinked])).Single();
        await Assert.That(stored.DeletedAt).IsNull();
    }

    [Test]
    public async Task ApplySkipsADeleteOfARecordNotStored()
    {
        await ApplyNext(FullAnalysis());

        await ApplyNext(new ChangeSet { Intent = "deleteMissing", TokenAnalyses = RecordChanges<TokenAnalysis>.Delete(Guid.NewGuid()) });

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(1);
        await Assert.That(await DbContext.TokenAnalyses.CountAsync()).IsEqualTo(3);
    }

    [Test]
    public async Task ApplyRecordsTheIntentOnTheCommit()
    {
        await ApplyNext(FullAnalysis());

        var commit = await DbContext.Commits.SingleAsync();
        await Assert.That(commit.Metadata[AnalysisRepository.IntentMetadataKey]).IsEqualTo("seed");
    }

    [Test]
    public async Task ApplyRefusesAnIdNamedTwiceInOneKindApplyingNothing()
    {
        await ApplyNext(FullAnalysis());

        await Assert.That(() => ApplyNext(new ChangeSet
        {
            Intent = "conflicting",
            TokenAnalyses = new RecordChanges<TokenAnalysis>([Token(TaAnd, "and", "also")], [TaAnd]),
        })).Throws<ArgumentException>();

        await Assert.That(await DbContext.Commits.CountAsync()).IsEqualTo(1);
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
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(TokenLink(Guid.NewGuid(), TaAnd, "ZZZ front1:0", "and")),
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
            TokenAnalyses = RecordChanges<TokenAnalysis>.Put(Token(capitalized, "And", "and")),
        });

        await Assert.That(IdsOf(await Repository.FindTokenAnalysesByForm([Refs.NormalizeSurfaceForm("AND")])))
            .IsEquivalentTo([TaAnd, capitalized]);
        await Assert.That(IdsOf(await Repository.FindPhraseAnalysesByForm([Refs.NormalizeSurfaceForm("In The")])))
            .IsEquivalentTo([PaInThe]);
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
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(TokenLink(TlGenBeginning, TaBeginning, "GEN 1:1:0", "and")),
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
            TokenAnalyses = RecordChanges<TokenAnalysis>.Put(Token(TaAnd, "and", "and"), Token(TaBeginning, "and", "also")),
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(
                TokenLink(larger, TaAnd, "GEN 1:1:0", "and"),
                TokenLink(smaller, TaBeginning, "GEN 1:1:0", "and")),
        });

        var counts = await Repository.CountApprovals([TaAnd, TaBeginning]);

        await Assert.That(counts).IsEquivalentTo(new Dictionary<Guid, int> { [TaBeginning] = 1 });
    }

    [Test]
    public async Task PassesOverAnApprovedLinkNamingNoStoredPayloadWhenPickingATie()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet
        {
            Intent = "approveMissing",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(TokenLink(Guid.NewGuid(), Guid.NewGuid(), "GEN 1:1:0", "and")),
        });

        var counts = await Repository.CountApprovals([TaAnd]);

        await Assert.That(counts).IsEquivalentTo(new Dictionary<Guid, int> { [TaAnd] = 2 });
    }

    [Test]
    public async Task FilesAnEditedRecordUnderItsNewKeysOnly()
    {
        await ApplyNext(FullAnalysis());
        await ApplyNext(new ChangeSet
        {
            Intent = "moveLink",
            TokenAnalysisLinks = RecordChanges<TokenAnalysisLink>.Put(TokenLink(TlGenAnd, TaBeginning, "LEV 1:1:0", "and")),
            TokenAnalyses = RecordChanges<TokenAnalysis>.Put(Token(TaAnd, "but", "but")),
        });

        await Assert.That(IdsOf((await Repository.FindLinksByToken(["GEN 1:1:0"])).TokenAnalysisLinks)).IsEmpty();
        await Assert.That(IdsOf((await Repository.FindLinksByToken(["LEV 1:1:0"])).TokenAnalysisLinks)).IsEquivalentTo([TlGenAnd]);
        await Assert.That(IdsOf((await Repository.FindLinksToAnalyses([TaAnd])).TokenAnalysisLinks)).IsEquivalentTo([TlExoAnd]);
        await Assert.That(await Repository.FindLinkedBooks()).IsEquivalentTo(["EXO", "GEN", "LEV"]);
        await Assert.That(IdsOf(await Repository.FindTokenAnalysesByForm(["and"]))).IsEmpty();
        await Assert.That(IdsOf(await Repository.FindTokenAnalysesByForm(["but"]))).IsEquivalentTo([TaAnd]);
    }
}
