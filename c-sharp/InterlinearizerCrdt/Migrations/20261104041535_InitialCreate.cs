using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Interlinearizer.Crdt.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Commits",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Hash = table.Column<string>(type: "TEXT", nullable: false),
                    ParentHash = table.Column<string>(type: "TEXT", nullable: false),
                    IsSnapshotCheckpoint = table.Column<bool>(type: "INTEGER", nullable: false),
                    Counter = table.Column<long>(type: "INTEGER", nullable: false),
                    DateTime = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Metadata = table.Column<string>(type: "jsonb", nullable: false),
                    ClientId = table.Column<Guid>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Commits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "LocalState",
                columns: table => new
                {
                    Key = table.Column<string>(type: "TEXT", nullable: false),
                    Value = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LocalState", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "ChangeEntities",
                columns: table => new
                {
                    Index = table.Column<int>(type: "INTEGER", nullable: false),
                    CommitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    EntityId = table.Column<Guid>(type: "TEXT", nullable: false),
                    Change = table.Column<string>(type: "jsonb", nullable: true),
                    AuthoredModelVersion = table.Column<int>(type: "INTEGER", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChangeEntities", x => new { x.CommitId, x.Index });
                    table.ForeignKey(
                        name: "FK_ChangeEntities_Commits_CommitId",
                        column: x => x.CommitId,
                        principalTable: "Commits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Snapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    TypeName = table.Column<string>(type: "TEXT", nullable: false),
                    Entity = table.Column<string>(type: "jsonb", nullable: false),
                    References = table.Column<string>(type: "TEXT", nullable: false),
                    EntityId = table.Column<Guid>(type: "TEXT", nullable: false),
                    EntityIsDeleted = table.Column<bool>(type: "INTEGER", nullable: false),
                    CommitId = table.Column<Guid>(type: "TEXT", nullable: false),
                    IsRoot = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Snapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Snapshots_Commits_CommitId",
                        column: x => x.CommitId,
                        principalTable: "Commits",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "InterlinearProject",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: true),
                    Description = table.Column<string>(type: "TEXT", nullable: true),
                    TargetProjectId = table.Column<string>(type: "TEXT", nullable: true),
                    AnalysisLanguages = table.Column<string>(type: "jsonb", nullable: false),
                    Segmentation = table.Column<string>(type: "jsonb", nullable: true),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InterlinearProject", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InterlinearProject_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PhraseAnalysis",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Gloss = table.Column<string>(type: "jsonb", nullable: true),
                    SenseRef = table.Column<string>(type: "jsonb", nullable: true),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    SurfaceText = table.Column<string>(type: "TEXT", nullable: false),
                    NormalizedForm = table.Column<string>(type: "TEXT", nullable: false),
                    Confidence = table.Column<int>(type: "INTEGER", nullable: true),
                    Producer = table.Column<string>(type: "TEXT", nullable: true),
                    SourceUser = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhraseAnalysis", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PhraseAnalysis_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "PhraseAnalysisLink",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Tokens = table.Column<string>(type: "jsonb", nullable: false),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    AnalysisId = table.Column<Guid>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    Confidence = table.Column<int>(type: "INTEGER", nullable: true),
                    BookCode = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhraseAnalysisLink", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PhraseAnalysisLink_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "SegmentAnalysis",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    FreeTranslation = table.Column<string>(type: "jsonb", nullable: true),
                    LiteralTranslation = table.Column<string>(type: "jsonb", nullable: true),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    SurfaceText = table.Column<string>(type: "TEXT", nullable: false),
                    NormalizedForm = table.Column<string>(type: "TEXT", nullable: false),
                    Confidence = table.Column<int>(type: "INTEGER", nullable: true),
                    Producer = table.Column<string>(type: "TEXT", nullable: true),
                    SourceUser = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SegmentAnalysis", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SegmentAnalysis_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "SegmentAnalysisLink",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    SegmentId = table.Column<string>(type: "TEXT", nullable: false),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    AnalysisId = table.Column<Guid>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    Confidence = table.Column<int>(type: "INTEGER", nullable: true),
                    BookCode = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SegmentAnalysisLink", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SegmentAnalysisLink_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "TokenAnalysis",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Morphemes = table.Column<string>(type: "jsonb", nullable: true),
                    MorphemesStale = table.Column<bool>(type: "INTEGER", nullable: true),
                    Pos = table.Column<string>(type: "TEXT", nullable: true),
                    Features = table.Column<string>(type: "jsonb", nullable: true),
                    Gloss = table.Column<string>(type: "jsonb", nullable: true),
                    GlossSenseRef = table.Column<string>(type: "jsonb", nullable: true),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    SurfaceText = table.Column<string>(type: "TEXT", nullable: false),
                    NormalizedForm = table.Column<string>(type: "TEXT", nullable: false),
                    Confidence = table.Column<int>(type: "INTEGER", nullable: true),
                    Producer = table.Column<string>(type: "TEXT", nullable: true),
                    SourceUser = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TokenAnalysis", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TokenAnalysis_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "TokenAnalysisLink",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "TEXT", nullable: false),
                    Token = table.Column<string>(type: "jsonb", nullable: false),
                    TokenRef = table.Column<string>(type: "TEXT", nullable: false),
                    SnapshotId = table.Column<Guid>(type: "TEXT", nullable: true),
                    ProjectId = table.Column<Guid>(type: "TEXT", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: true),
                    AnalysisId = table.Column<Guid>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Status = table.Column<int>(type: "INTEGER", nullable: false),
                    Confidence = table.Column<int>(type: "INTEGER", nullable: true),
                    BookCode = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TokenAnalysisLink", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TokenAnalysisLink_Snapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "Snapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InterlinearProject_SnapshotId",
                table: "InterlinearProject",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PhraseAnalysis_ProjectId_NormalizedForm",
                table: "PhraseAnalysis",
                columns: new[] { "ProjectId", "NormalizedForm" });

            migrationBuilder.CreateIndex(
                name: "IX_PhraseAnalysis_SnapshotId",
                table: "PhraseAnalysis",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PhraseAnalysisLink_ProjectId_AnalysisId",
                table: "PhraseAnalysisLink",
                columns: new[] { "ProjectId", "AnalysisId" });

            migrationBuilder.CreateIndex(
                name: "IX_PhraseAnalysisLink_ProjectId_BookCode_Status",
                table: "PhraseAnalysisLink",
                columns: new[] { "ProjectId", "BookCode", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_PhraseAnalysisLink_SnapshotId",
                table: "PhraseAnalysisLink",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SegmentAnalysis_SnapshotId",
                table: "SegmentAnalysis",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SegmentAnalysisLink_ProjectId_AnalysisId",
                table: "SegmentAnalysisLink",
                columns: new[] { "ProjectId", "AnalysisId" });

            migrationBuilder.CreateIndex(
                name: "IX_SegmentAnalysisLink_ProjectId_BookCode_Status",
                table: "SegmentAnalysisLink",
                columns: new[] { "ProjectId", "BookCode", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_SegmentAnalysisLink_ProjectId_SegmentId",
                table: "SegmentAnalysisLink",
                columns: new[] { "ProjectId", "SegmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_SegmentAnalysisLink_SnapshotId",
                table: "SegmentAnalysisLink",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Snapshots_CommitId_EntityId",
                table: "Snapshots",
                columns: new[] { "CommitId", "EntityId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Snapshots_EntityId",
                table: "Snapshots",
                column: "EntityId");

            migrationBuilder.CreateIndex(
                name: "IX_TokenAnalysis_ProjectId_NormalizedForm",
                table: "TokenAnalysis",
                columns: new[] { "ProjectId", "NormalizedForm" });

            migrationBuilder.CreateIndex(
                name: "IX_TokenAnalysis_SnapshotId",
                table: "TokenAnalysis",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TokenAnalysisLink_ProjectId_AnalysisId",
                table: "TokenAnalysisLink",
                columns: new[] { "ProjectId", "AnalysisId" });

            migrationBuilder.CreateIndex(
                name: "IX_TokenAnalysisLink_ProjectId_BookCode_Status",
                table: "TokenAnalysisLink",
                columns: new[] { "ProjectId", "BookCode", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_TokenAnalysisLink_ProjectId_TokenRef",
                table: "TokenAnalysisLink",
                columns: new[] { "ProjectId", "TokenRef" });

            migrationBuilder.CreateIndex(
                name: "IX_TokenAnalysisLink_SnapshotId",
                table: "TokenAnalysisLink",
                column: "SnapshotId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Commits_DateTime_Counter_Id",
                table: "Commits",
                columns: new[] { "DateTime", "Counter", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Commits_Checkpoint",
                table: "Commits",
                columns: new[] { "DateTime", "Counter", "Id" },
                filter: "\"IsSnapshotCheckpoint\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChangeEntities");

            migrationBuilder.DropTable(
                name: "InterlinearProject");

            migrationBuilder.DropTable(
                name: "LocalState");

            migrationBuilder.DropTable(
                name: "PhraseAnalysis");

            migrationBuilder.DropTable(
                name: "PhraseAnalysisLink");

            migrationBuilder.DropTable(
                name: "SegmentAnalysis");

            migrationBuilder.DropTable(
                name: "SegmentAnalysisLink");

            migrationBuilder.DropTable(
                name: "TokenAnalysis");

            migrationBuilder.DropTable(
                name: "TokenAnalysisLink");

            migrationBuilder.DropTable(
                name: "Snapshots");

            migrationBuilder.DropTable(
                name: "Commits");
        }
    }
}
