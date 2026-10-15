# Gameplay and CPU audit, 2026-10-15

What this repo does: People read a work introduction, invent false titles and vote for the real one. A single Render writer saves rooms and private history to Neon; Expo Web runs on Vercel. This audit assumes the documented 2–6 seats per room and one server instance.

Issue #142 records the owner's request and exact scope. This follows published PR141 (`0c969c1f5322859138348a61a6e5811526fb27cd`); it does not revive old candidates. The source Issue and PR metadata are the authority for current publication state.

## Reproduced and fixed

1. **Recovery followed by reselection can stop the game** (`client/src/screens/GameScreen.js`).
   - What this is: A player restores their seat after declaring whether they know a work.
   - Problem: Reselecting the work clears server declarations but restores the old declaration in the remounted screen. The buttons disappear while the server waits for a new answer.
   - Fix: Apply the recovery snapshot only before the first selection revision. Known/unknown and human/CPU regressions cover this; real browser tests redeclare after recovery and reselection.
   - If skipped: The room needs another reload to progress.
2. **Late titles bypass the displayed deadline** (`server/src/socket/gameHandlers.js`).
   - What this is: Consent mode waits for the controller after closing title entry.
   - Problem: A silent player can still add a title after `phase_ready=true`.
   - Fix: Reject new submissions in that state and replace the input with an accessible closed notice. Preserve the existing zero-answer rescue. Test timer expiry, voting, scores and MVP through the real handlers and mobile UI.
   - If skipped: Some players receive extra thinking time after others are told entry has closed.
3. **A CPU false title can equal the answer** (`server/src/computerTitles.js`).
   - What this is: CPU seats choose authored false titles from story cues.
   - Problem: A ghost story whose answer is “まだ、そこにいる” can receive the same CPU title. Equal labels have different answer IDs and different correctness.
   - Fix: Exclude the correct title and verified aliases using normalized punctuation/case. The handler supplies them internally. This adds no answer-testing response to human input; intentional human duplicate labels and self-vote rules remain unchanged.
   - If skipped: Visually identical choices can score differently.
4. **A restart loses cross-URL work exclusions** (`server/src/questions/live.js`, `server/src/socket/gameHandlers.js`).
   - What this is: Each request discovers and independently verifies current work pages.
   - Problem: URL IDs survive in rooms, but the source's title exclusion map does not survive restart. A different URL can reintroduce the same work.
   - Fix: Persist title/kind exclusion metadata in the same atomic room snapshot and pass it on CPU and helper requests. Read existing source questions for older rooms. Source-recreation and actual room serialization tests cover the boundary.
   - If skipped: Previously played works can return after a server restart. Old discarded works whose titles were never saved cannot be reconstructed.
5. **Cast and advertising prose can pad a question** (`server/src/questions/quality.js`).
   - What this is: The existing extractor selects complete introduction sentences.
   - Problem: Director/cast credits and praise can fill the minimum length without describing the story.
   - Fix: Exclude those sentences in the shared validator/extractor. Do not lower the 120-character minimum or fabricate replacement text. An insufficient introduction now fails and permits normal retry.
   - If skipped: Players receive irrelevant clues and misleading CPU story cues.
6. **Expired history can still say “playing”** (`server/src/gameHistory.js`).
   - What this is: Private history distinguishes completed, active and interrupted games.
   - Problem: Before another room action prunes an expired room, read-only history treats its presence as proof of activity.
   - Fix: Include room expiry in the active-set check. List/detail regressions verify interrupted status without mutating or exposing any archive.
   - If skipped: History mislabels a game that can no longer be resumed.

## CPU quality evaluation

Inspect each output for source/title consistency, a coherent story, title leaks, complete modern Japanese, irrelevant metadata, natural decoys, variety, fair title form and repeats. A successful HTTP request or unit-test count does not establish quality. Difficulty is a human judgement here; no accuracy percentage or player familiarity was inferred from source popularity.

The isolated runtime ran four media twice per cycle. Initial, first correction and query correction used 28 requests and 45 seconds per selection, below the production 64-request/60-second limits. A separate new-case cycle used 64 requests/45 seconds. Calls were sequential with pauses; no new paid API or production stress loop was used. Only generated short introductions, source URLs and rejection reasons were saved privately outside the public repository, not full source pages.

| Cycle | Novel | Film | Game | Manga | Meaning |
| --- | --- | --- | --- | --- | --- |
| Initial | 2/2 | 2/2 | 0/2 | 0/2 | Credits and generic decoys visible; failures are genuine, bounded attempts |
| First correction | 2/2 | 2/2 | 0/2 | 1/2 | Some metadata removed; retrieval and title-form quality still inadequate |
| New cases, 64 requests | 2/2 | 2/2 | 2/2 | 1/2 | Larger budget helps retrieval; not a controlled speed/quality improvement |
| Query correction, 28 requests | 1/2 | 2/2 | 0/2 | 0/2 | No measured retrieval-rate improvement; retain this negative result |
| English/non-recycling/late-route correction, 64 requests | 2/2 | 2/2 | 2/2 | 1/2 | Seven verified selections with 35 distinct CPU decoys; one genuine retrieval failure. Later content review still rejected three of these works |
| Final content correction, new cases, 64 requests | 1/1 | 1/1 | 1/1 | 1/1 | Four fresh verified selections; this small sample is not a reliability estimate |

The second discovery pass previously repeated the same broad search intent. It now uses the existing work-introduction query; manga uses collection/publisher introductions instead of volume-one wording that conflicted with volume exclusions. All work, distribution, source, robots, private-network, deadline and request-budget checks remain in force.

Concrete comparisons:

- Synthetic crime-film viewing followed by family farming previously selected robbery titles. Ignoring the consumed-work reference selects farming titles such as “種をまく日々”. Existing kidnapping/time-loop/court/horror tests still keep specific events ahead of repeated settings.
- Repeated ghost-story CPU requests exclude the answer and all earlier CPU titles in the match. A single theme/language pool has seven authored titles; if it runs out, other themes actually present in the introduction may supply unused candidates. The live selector rejects works with insufficient candidates and searches for another independently verified work within the existing genre and budgets. It never serves a stock question or recycles earlier titles. If no suitable work remains, a specific retry/reselection notice is returned; human entry and guest privacy stay unchanged.
- The same [DIGGER source](https://www.cinematoday.jp/movie/T0031798) previously padded its plot with actor/director credits. The corrected extractor rejects it because the remaining plot is too short. Rejection is a quality safeguard, not successful question generation.
- The same publisher introduction for “陰態の家 夢枕獏超越的物語集” drops praise and retains actual short-story descriptions. It still describes a collection, so coherence for a single guessing round is limited.
- “THE 13th Digit” previously received Japanese generic titles. It now receives English legal themes such as “The Last Clause” and “Final Verdict”. “Lostbound” now receives English maze/exploration titles such as “Vanishing Paths” and “The Last Descent”. The same real introductions were used. Latin-only real titles use authored English candidates; Japanese titles retain Japanese candidates. This reduces the language giveaway, but does not claim equal difficulty across every title length, number or writing style.
- Same-source review found an anniversary collection naming its franchise, a quoted primary-text passage credited to a story, and cast credits in another film. The shared title-alias rule now masks the anniversary base name and the named story following a short-collection label, without changing the real title. The source quality rule excludes credited primary excerpts and further credits/praise. “ゴジラ70周年記念短編集”, “ミッドワイフの家” and the cast-padded film were rejected after their safe introduction became too short. No replacement synopsis was invented. Of seven same-source checks, three remained usable, three failed content quality and one publisher request timed out; a timeout is not evidence that its content was repaired or rejected for quality.

The new novel sample described exploitation, a broken engagement and staged disappearance, yet its engagement cue initially picked happy-romance candidates. Specific exploitation/broken-engagement cues now lead to betrayal/revenge-toned authored candidates. This keeps the real source unchanged; the decoys are deliberately fictional possible titles, not claims about the work's actual ending.

The late-route failure was reproduced with an immediate queue of invalid pages and a valid independent route arriving 20 ms later. The old source spent the eight-request budget before that route arrived. The corrected source reserves its remaining budget and retrieves the verified work, still within eight requests. Production transports remain bound by the shared deadline, abort and per-fetch timeout. This fixture result does not establish an overall live retrieval-rate increase.

## Validation and limits

The final local server suite has 457 tests, including the exploitation-tone regression after the 456-test pass. These cover English decoys, non-recycling exhaustion with no partial state, verified alternate-work selection, late independent discovery, durable exclusions, collection aliases and primary-excerpt rejection. The exact final result is recorded on PR143. Python 49 tests, repository/public-export guards and Expo Web build passed before the server-only continuation; the final exact-head native checks are recorded on PR143. Real local Chromium checked human/CPU recovery/reselection, mobile closed-entry UI, vote/score/MVP progress, a single correct-label choice, English choices and candidate exhaustion followed by successful new-theme selection. Published PR141 was separately verified through the production UI: human two rounds, CPU three live-source rounds, exit/reload history, two games, third-party denial, desktop/mobile and no application console errors.

Verdict: The reproduced correctness failures are repaired in this candidate. CPU retrieval and decoy quality still need further improvement; this audit does not declare all outputs good.

Not checked: Real Discord consent/provider setup, native mobile clients, every source domain, every possible work, production stress, multi-writer operation or forced production restarts. No source-wide rights grant is inferred from a public page. Existing lawful-source restrictions and attribution stay unchanged. Open candidate collisions must pass the unchanged Coordinator gate before this follow-up can be released.
