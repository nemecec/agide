# Probes P54 to P56: test reports, XML parsers and zero tests (checks-design)

Date: 2026-11-26. Host: macOS (APFS), Node 22.22.3, vitest 5.1.0 (the app's own dependency), cargo 1.99.0, cargo-nextest 0.9.149, Gradle 9.5.1 with JUnit Jupiter 6.1.3 from the local Gradle cache (`--offline`), Java 24 (Gradle launcher) and 21. No model was started and nothing was downloaded: fast-xml-parser 5.11.2 came from the local npm cache with `npm pack --offline`. Throwaway projects and inputs under `/tmp/agide-checks-design/`, left for the coordinator to remove (the permission system denied the removal). Scripts: `probes/p_checks_lib.mjs` (sanitizer, prototype JUnit subset reader, libtest reader), `probes/p54_report_samples.mjs`, `probes/p55_xml_parsers.mjs`, `probes/p56_zero_tests.mjs`. Evidence: `probes/out/p54_results.json`, `probes/out/p54_samples/` (host name, user name, home and temporary root replaced), `probes/out/p55_results.json`, `probes/out/p56_results.json` (`probes/out/` is not tracked).

Not run here: pytest (python 3.15 has no pytest installed, and a network install is not allowed in this run), Maven surefire (the plugin is not in `~/.m2`, so `mvn -o` cannot run), jest with `jest-junit` (not installed). Their formats are taken from their documentation below and are marked as such.

## P54 Real report samples

Each project has a passing, a failing, a skipped test and a test whose name holds `<`, `&`, `"` and a BEL control character.

| Tool | Command | Exit | Report | What the report says |
|---|---|---|---|---|
| vitest 5.1.0 | `vitest run --reporter=default --reporter=junit --outputFile.junit=reports/junit.xml` | 1 | one file, `<testsuites>` with one `<testsuite>` per test file (`name` = the file path, `hostname` = the host's name) and `<testcase classname="<file>" name="<describe> > <test>">` | failure as `<failure message="..." type="AssertionError">` with the diff as text; `it.skip` and `it.todo` both as `<skipped/>`; the BEL character is dropped from the name, so the XML name differs from the console name |
| cargo test (libtest text) | `cargo test --no-fail-fast` | 101 | none; stdout has one block per test binary: `running N tests`, N lines `test <path> ... ok`, `FAILED`, `ignored[, reason]` or `<path> - should panic ... ok`, then `failures:` with the captured output of each failing test, then `test result: ok\|FAILED. P passed; F failed; I ignored; M measured; X filtered out`. The `Running <target> (<binary path>)` lines go to stderr | a failing test that prints `test tests::subtracts_wrongly ... ok` puts that line into its `---- <name> stdout ----` section after the list; a reader that takes every `test ... ok` line counts the failing test as passed too. With `--nocapture` the printed lines land inside the list (`test tests::forged ... ok`) |
| cargo nextest 0.9.149 | `cargo nextest run --profile ci` with `[profile.ci.junit] path = "junit.xml"` | 100 | `target/nextest/ci/junit.xml`: `<testsuites name="nextest-run" uuid=...>`, one `<testsuite>` per test binary (`name` = the binary id, `p54` or `p54::integration`), `<testcase name="tests::adds" classname="p54">` | failure as `<failure message="thread '...' (<thread id>) panicked at src/lib.rs:6:38" type="test failure with exit code 101">` plus `<system-out>` and `<system-err>` of the failing test; the message holds a thread id that changes with each run; an ignored test is not in the report at all (`skipped="0"` while the summary says one skipped) |
| Gradle 9.5.1, JUnit Jupiter 6.1.3 | `gradle test --offline` | 1 | `build/test-results/test/TEST-<class>.xml`, one file per test class, root `<testsuite>` (no `<testsuites>`) with `hostname` and `<properties/>` | an assertion and an `IllegalStateException` both as `<failure>` (no `<error>`); `@Disabled` as `<skipped/>`; the method name with `()` as `name`; a `@DisplayName` with BEL has U+FFFD in its place |

The prototype reader of `p_checks_lib.mjs` read every sample and gave the same pass, fail and skip sets as the tools' own summaries. Times: vitest 0.4 s, cargo test 1.0 s, nextest 0.8 s, Gradle 13.8 s (`--no-daemon`).

Formats from documentation only (not produced here):

- pytest `--junitxml=path` writes `<testsuites><testsuite name="pytest" errors failures skipped tests time timestamp hostname>` with `<testcase classname="pkg.module.Class" name="test_x" file line>`; failures as `<failure message>`, errors in setup or teardown as `<error message>`, skips as `<skipped type="pytest.skip" message>`; `junit_family` `xunit2` is the default since pytest 6 (pytest documentation, "Creating JUnitXML format files").
- Maven surefire writes `target/surefire-reports/TEST-<class>.xml` with a root `<testsuite>` and `<properties>` holding the system properties of the forked JVM (the user name, the home directory and paths among them); failures as `<failure>`, exceptions as `<error>`, skips as `<skipped>`; re-runs as `<flakyFailure>` and `<rerunFailure>` (surefire documentation, "Surefire XML Reporter"). The properties are one more reason to keep only names, statuses and messages.
- jest with `jest-junit` writes `junit.xml` (`JEST_JUNIT_OUTPUT_DIR`, `JEST_JUNIT_OUTPUT_NAME`), suites per test file, `classname` and `name` built from templates (`{classname} {title}` by default); vitest's `junit` reporter follows the same shape.
- cargo nextest's JUnit is described in its documentation ("JUnit support"); flaky retries add `<flakyFailure>` and `<rerunFailure>` elements under a passing `<testcase>`.
- libtest's `--format json` and `--format junit` need `-Z unstable-options`, so a stable toolchain gives text only.

## P55 XML parsers against hostile reports

Each candidate and case ran in its own Node process (`--max-old-space-size=2048`, time limit 180 s); peak RSS from `process.resourceUsage()`.

| Case | prototype subset reader | saxes 6.0.0 | fast-xml-parser 5.11.2 (default) | fast-xml-parser, `processEntities: false` |
|---|---|---|---|---|
| valid report | parsed, 2 ms | parsed, 16 ms | parsed | parsed, `&amp;` left as text |
| billion laughs (nine levels of ten) | refused (DOCTYPE) | refused (`undefined entity`: the internal subset is not processed) | parsed, the reference left as the literal `&lol9;` | same |
| 200,000 nested elements | refused (depth 32) | parsed, 86 ms, 133 MB (no recursion, no limit) | refused (`Maximum nested tags exceeded`) | same |
| 50 MB attribute | refused (tag too long) | parsed, 272 ms, 198 MB | parsed, 518 ms, 268 MB | parsed, 434 ms, 268 MB |
| DOCTYPE with a `SYSTEM` entity naming a canary file | refused (DOCTYPE) | refused (`undefined entity`); the canary was not read | refused (`External entities are not supported`) | same |
| undeclared entity | refused | refused (`undefined entity`) | parsed, literal `&nope;` | same |
| 200 MB, 2,750,000 test cases | refused at 100,000 cases after 106 ms; without limits parsed in 3.2 s, 763 MB (it keeps every case) | parsed in 1.8 s, 84 MB (streaming events, the probe kept a count) | parsed in 13.4 s, 1,772 MB (a whole tree from one string) | 9.1 s, 1,796 MB |

Rerun by the independent review (same host and day, a private copy of the scripts, fast-xml-parser unpacked from the same cached tarball): every case had the same outcome; saxes 1.9 s at 82 MB for 200 MB, fast-xml-parser 7.2 s at about 1.85 GB with entity processing on and off, the prototype without limits 2.7 s at 761 MB. saxes reports an error through its `error` handler and goes on parsing when a handler is set (`fail` in `saxes.js`), so the reader has to stop at the first error itself.

No candidate read a file or the network. saxes 6.0.0 is already in the lockfile as a dependency of jsdom (dev only), with its dependency `xmlchars` 2.2.0. fast-xml-parser 5.11.2 is not in the repository; its package lists dependencies of its own (`@nodable/entities`, `fast-xml-builder`, `is-unsafe`, `path-expression-matcher`, `strnum`, `xml-naming`) although `lib/fxp.cjs` bundles them; it needs the whole report as one string and builds a tree, so its memory grows with the report. The prototype refuses everything hostile but is no conforming XML reader: it cuts a tag at the first `>`, so a valid attribute that holds a raw `>` is refused, and every such gap is code the app would own and test.

## P56 Zero tests

| Tool and case | Exit | Report |
|---|---|---|
| vitest, no test files | 1 (`No test files found, exiting with code 1`) | written, no test case |
| vitest, a test file without tests | 1 (`No test suite found in file`) | written, one failed suite entry |
| vitest, `-t` filter matches nothing | 0 | one case, skipped |
| vitest, every test skipped | 0 | one case, skipped |
| cargo test, no tests | 0 (`running 0 tests`, `test result: ok. 0 passed`) | none |
| cargo test, filter matches nothing | 0 (`1 filtered out`) | none |
| cargo test, every test ignored | 0 (`1 ignored`) | none |
| cargo nextest, each case above | 4 (`error: no tests to run`) | none |
| Gradle, no test sources | 0 (`:test NO-SOURCE`) | none |
| Gradle, test sources without tests | 1 (`failOnNoDiscoveredTests`) | none |
| Gradle, `--tests` filter matches nothing | 1 (`No tests found for given includes`) | none |
| Gradle, every test `@Disabled` | 0 | one case, skipped |

Documented, not run: pytest exits 5 when it collects no tests; jest exits 1 with `No tests found` unless `--passWithNoTests`; Maven surefire passes a module without tests (`No tests to run.`) and fails a `-Dtest` filter that matches nothing unless `-Dsurefire.failIfNoSpecifiedTests=false`.

## Design effects

1. A check that exits 0 with zero executed tests is real for cargo test, vitest with a filter or with every test skipped, and Gradle without test sources or with every test disabled. The count that matters is passed plus failed; skipped tests do not count.
2. Without a report the only stable source for a count is the libtest text, and only its list blocks (`running N tests`, N lines, the result line); a check of the line count against N and against the result line refuses the forged lines of a failing test's output, but not a test that writes a whole block to the real stdout.
3. A test's identity is its suite or class and its name; messages carry thread ids, times and paths and are not part of the identity. Gradle and nextest write one suite per class or binary, vitest one per file.
4. Names differ between the console and the XML (dropped or replaced control characters), so the card shows the XML name through the plain-text path and never matches console text against it.
5. saxes gives a conforming streaming reader with no entity expansion and no I/O, in about 1.8 s for 200 MB at flat memory; the depth, attribute, count and byte limits have to sit in the handler around it. fast-xml-parser's tree model costs about 9 bytes of RSS per byte of report.
6. nextest leaves ignored tests out of its report and puts flaky retries into `flakyFailure` elements under a passing case; Maven puts JVM properties into each report. The reader keeps only suite, name, status and the first part of the message.
