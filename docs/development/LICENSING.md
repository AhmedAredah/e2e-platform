# Licensing and source origin

This fork uses the MIT-licensed history of `tester-army/e2e` as its base.
The project's own code is offered under MIT. Dependencies, separately
identified third-party material, and the application under test retain their
own licenses.

## Historical base

The base is commit
[`e9c2914c6d8f8d664d820b13a1fa454e9247e94b`](https://github.com/tester-army/e2e/commit/e9c2914c6d8f8d664d820b13a1fa454e9247e94b),
dated September 20, 2026. Its
[root license](https://github.com/tester-army/e2e/blob/e9c2914c6d8f8d664d820b13a1fa454e9247e94b/LICENSE)
and the license files in its five publishable packages are MIT. Its
[contribution terms](https://github.com/tester-army/e2e/blob/e9c2914c6d8f8d664d820b13a1fa454e9247e94b/CONTRIBUTING.md)
also specify MIT for contributions.

The next mainline commit,
[`ca5e6196b620165dcabc383c1aaf35c44cf22690`](https://github.com/tester-army/e2e/commit/ca5e6196b620165dcabc383c1aaf35c44cf22690),
changed upstream licensing to Apache-2.0 on September 21, 2026. This fork's
source ancestry starts before that change. The MIT copyright and permission
notice for TesterArmy, Inc. is retained in [LICENSE](../../LICENSE).

## Extension provenance

The C++ additions were developed in an earlier local candidate. Its base was
a later upstream revision, and that candidate used Apache-2.0 metadata.
For this fork, only the separately added extension files were selected for
porting. Later upstream core files and their implementations were not copied
as part of that import. The missing runner integration is implemented against
the MIT base.

[extension-origin.json](extension-origin.json) records all 174 initially
selected files, their source revision, their first local addition, and their
SHA-256 before porting. The source candidate was
`d5d0b2455a1eacdec372b1dac725bbfd76bb4a2d`; it is preserved separately from
this fork. Of those files, 156 first appeared in the original extension
commit, 11 in its first hardening commit, and 7 in its second hardening commit.
License and notice files are recorded separately from implementation files.

The maintainer authorized offering the original extension work under MIT.
The `e2e-platform contributors` copyright notice identifies the original fork
contributions collectively. It does not replace the upstream copyright
notice, assign ownership, or grant rights in third-party material.

The review compared the imported extension text with both the MIT base and
the later upstream tree. It found no block of eight consecutive nonblank,
whitespace-normalized lines containing at least 200 characters that occurred
only in the later upstream tree. This is a similarity screen with a stated
threshold, not proof of authorship or legal independence. The machine-readable
scope and results are in [licensing-audit.json](licensing-audit.json).

The original 0.1.0 candidate screen covered 496 changed or new text source files.
Thirteen matching windows in five files were reviewed against the MIT diff.
They combine existing MIT text with directory renaming, a dependency-version
correction, or small interface edits; the review did not identify a later
upstream implementation copied into this fork. The evidence bundle records
SHA-256 hashes for 396 implementation, test and source-configuration files.
All 174 import-manifest hashes and their stated first-addition commits were
also checked without mismatches.

The final license inventory preserves upstream attribution in the root and
all five inherited package licenses, and adds fork attribution alongside it.
The five extension packages and Qt helper/examples carry MIT licenses. The
vendored `unbox-ai` developer skill also includes its source project's MIT
license and copyright notice. The provenance of the inherited `unslop` skill
is recorded in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md); this
record does not claim that its current external source repository is MIT.

The 0.2.0-rc.0 hardening work is recorded in subsequent fork commits. It was
implemented against this MIT checkout without importing later upstream source.
The original similarity-screen counts above describe the initial rebuild, not
a repeated screen of every later edit.

## Maintaining the boundary

- Keep the MIT upstream attribution and each applicable third-party notice.
- Record the source and license before importing code, tests, documentation,
  generated templates, or assets.
- Check later upstream changes individually. An Apache-covered change keeps
  its applicable conditions if incorporated. Changing its language or syntax
  does not establish independent origin.
- Keep current fork package names and dependencies distinct from upstream.
  Package metadata must describe the code actually shipped.
- Build source archives from the fork's tracked files and intended Git
  ancestry. Do not copy the earlier candidate's entire Git directory into an
  archive described as this MIT-based fork.
- Keep license and attribution files in npm packages and installed native
  helper distributions. Review the complete contents of any binary bundle.

## Dependencies and review limits

See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) for the dependency
boundary and source attributions. MIT licensing of this project does not
relicense Qt, Node.js, browser binaries, package dependencies, or user code.

This record documents the selected source history, the import process, and
the review performed. It does not independently establish employment rights,
contributor assignments, patent rights, trademark rights, or the absence of
unidentified copied material. Any later discovery of separately licensed
material must be reflected in the relevant files and distribution notices.

Primary license texts are the [MIT license](https://opensource.org/license/mit)
and [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).


The 0.2.0-rc.1 desktop work was independently implemented on this MIT checkout.
The project and unpublished npm scope were renamed to `e2e-platform` and
`@e2e-platform/*`. Current `scripts/native/` files formerly lived in `scripts/cpp/`;
`SUPPORT_MATRIX.md` and `INSTALL.md` formerly used the `CPP_SUPPORT.md` and
`INSTALL_CPP.md` names. The original extension-origin inventory intentionally
retains its historical source paths and before-port hashes. New OS sidecar source
and examples have separate MIT notices; externally installed SDKs and dependencies
retain their own terms. No later Apache-only upstream implementation was copied.
