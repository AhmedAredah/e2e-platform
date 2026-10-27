# Publishing the reviewed candidate

The canonical repository is `AhmedAredah/e2e-platform`, a GitHub fork of
`tester-army/e2e`. The reviewed candidate source and default branch are `mit-main`.
Source publication is separate from package publication and release qualification;
no GitHub release has been published. The branch is rooted at MIT
revision `e9c2914c6d8f8d664d820b13a1fa454e9247e94b`. Preserve the separately
copied upstream `main` branch and its Apache terms. Do not merge that branch
into the MIT line without reviewing every imported license obligation.

## Source publication

From the reviewed checkout, using your own authenticated Git installation:

```sh
git status --short
git branch --show-current
# Add origin only if this checkout does not already have it.
git remote add origin https://github.com/AhmedAredah/e2e-platform.git
git push --set-upstream origin mit-main
```

Review the destination if `origin` already exists. Do not use a force push.
Select `mit-main` as the repository's default branch in GitHub Settings after
the push succeeds. Verify that the published tree matches the reviewed local
tree (`git rev-parse HEAD^{tree}`), that README and LICENSE are from this line,
and that the fork relationship remains visible. Retain original attribution;
the fork association does not imply endorsement by upstream.

## Candidate qualification

Run `pnpm check:local`, the package suites, native and language verifiers, and
the installed-consumer checks listed in `verification/README.md`. The
`local-install-kit` workflow repeats the coordinated package checks and creates
an artifact only after its required jobs succeed. A workflow file alone does
not establish a pass. Record any skips and host restrictions explicitly.

The current package version is a prerelease. Do not advertise stable or complete
desktop support until the real OS/toolkit profiles pass and the dependency
findings recorded in `RELEASE_STATUS.md` have been resolved or assessed for the
exact distribution. The existing manual desktop workflow requires prepared,
trusted interactive runners. Do not run untrusted pull-request code on those
machines with credentials or broad host access.

## Packages and release files

`pnpm pack:native` builds a checksummed six-package consumer kit. Run
`node scripts/native/install-kit-smoke.mjs --kit release-packages` against the
exact files being distributed. Optional browser and mobile packages have the
separate installation workflow in `INSTALL.md`. npm namespace ownership and
registry publication remain separate actions; this repository does not claim
that the package names are reserved or published.

Create a GitHub prerelease only from the reviewed `mit-main` commit. State the
source revision, actual checks, unqualified platforms and third-party license
boundaries. A GitHub source ZIP excludes Git history and generated install kits;
label any prepared full-history or binary bundle separately and verify its
contents and checksums. Review notices for everything included in a binary or
offline dependency bundle.
