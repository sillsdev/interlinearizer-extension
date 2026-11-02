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
    public async Task ApplyInPatchModeSetsTheFieldsThePutCarriesAndMergesMultistrings()
    {
        await ApplyNext(FullAnalysis());
        var put = new TokenAnalysis
        {
            Id = TaBeginning,
            SurfaceText = "Beginning",
            Gloss = new MultiString { ["fr"] = "début" },
        };

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) }, PutMode.Patch);

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.SurfaceText).IsEqualTo("Beginning");
        await Assert.That(stored.Gloss).IsEquivalentTo(new Dictionary<string, string> { ["en"] = "start", ["fr"] = "début" });
        var changes = await DbContext.ChangeEntities.ToListAsync();
        await Assert.That(changes.Select(c => c.Change).OfType<PatchTokenAnalysisChange>().Count()).IsEqualTo(1);
    }

    [Test]
    public async Task ApplyInPatchModeLeavesAMultistringThePutLacksAlone()
    {
        await ApplyNext(FullAnalysis());
        var put = new TokenAnalysis { Id = TaBeginning, SurfaceText = "beginning" };

        await ApplyNext(new ChangeSet { Intent = "patch", TokenAnalyses = RecordChanges<TokenAnalysis>.Put(put) }, PutMode.Patch);

        var stored = (await Repository.GetTokenAnalyses([TaBeginning])).Single();
        await Assert.That(stored.Gloss).IsEquivalentTo(new Dictionary<string, string> { ["en"] = "start" });
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
