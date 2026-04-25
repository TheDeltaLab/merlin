# Changelog

## [1.11.1](https://github.com/TheDeltaLab/merlin/compare/v1.11.0...v1.11.1) (2026-04-25)


### Bug Fixes

* lower default cpuRequest from 250m to 100m, bump AKS maxCount to 6 ([#110](https://github.com/TheDeltaLab/merlin/issues/110)) ([9c25ecb](https://github.com/TheDeltaLab/merlin/commit/9c25ecb0d02d0a59fb0f978b76f1515e58cd697b)), closes [#109](https://github.com/TheDeltaLab/merlin/issues/109)

## [1.11.0](https://github.com/TheDeltaLab/merlin/compare/v1.10.1...v1.11.0) (2026-04-17)


### Features

* add lovelace & cortex federated credentials and onboarding docs ([#101](https://github.com/TheDeltaLab/merlin/issues/101)) ([ef2369b](https://github.com/TheDeltaLab/merlin/commit/ef2369b8c63bf4e2be19f7843a3519e78b5ee2a5)), closes [#100](https://github.com/TheDeltaLab/merlin/issues/100)


### Bug Fixes

* make AzureServicePrincipal client secret generation idempotent ([#103](https://github.com/TheDeltaLab/merlin/issues/103)) ([3e40dba](https://github.com/TheDeltaLab/merlin/commit/3e40dba016791c4eb115a6d4e3e937b39367a7f1)), closes [#102](https://github.com/TheDeltaLab/merlin/issues/102)

## [1.10.1](https://github.com/TheDeltaLab/merlin/compare/v1.10.0...v1.10.1) (2026-04-17)


### Bug Fixes

* replace az ad sp list with az ad sp show + create fallback ([#98](https://github.com/TheDeltaLab/merlin/issues/98)) ([7ec38b5](https://github.com/TheDeltaLab/merlin/commit/7ec38b5ec86976d68f74e653e4dd9ba3ef9818e4)), closes [#96](https://github.com/TheDeltaLab/merlin/issues/96)

## [1.10.0](https://github.com/TheDeltaLab/merlin/compare/v1.9.0...v1.10.0) (2026-04-16)


### Features

* add synapse GitHub federated credentials to shared SP ([#92](https://github.com/TheDeltaLab/merlin/issues/92)) ([bf2442a](https://github.com/TheDeltaLab/merlin/commit/bf2442a7be5f65d59bd49f474364f27545ea2350)), closes [#91](https://github.com/TheDeltaLab/merlin/issues/91)


### Bug Fixes

* ensure Service Principal exists in SP update path ([#97](https://github.com/TheDeltaLab/merlin/issues/97)) ([b657948](https://github.com/TheDeltaLab/merlin/commit/b6579480f48e9e820de77352fe3367f03f88c0a9))

## [1.9.0](https://github.com/TheDeltaLab/merlin/compare/v1.8.0...v1.9.0) (2026-04-09)


### Features

* add Redis Enterprise Entra ID auth with automatic access policy assignments ([#86](https://github.com/TheDeltaLab/merlin/issues/86)) ([ea51a8b](https://github.com/TheDeltaLab/merlin/commit/ea51a8b911f6f6b4ac7dfd3fe97a83adb771db27))
* upgrade GitHub SP to full CI/CD deploy permissions ([#83](https://github.com/TheDeltaLab/merlin/issues/83)) ([af029e4](https://github.com/TheDeltaLab/merlin/commit/af029e406ca08834cffe4e1856e2fd16deaa0a78))

## [1.8.0](https://github.com/TheDeltaLab/merlin/compare/v1.7.3...v1.8.0) (2026-04-07)


### Features

* add babbage federated credentials to shared resources ([#77](https://github.com/TheDeltaLab/merlin/issues/77)) ([63d746a](https://github.com/TheDeltaLab/merlin/commit/63d746a05819f566d0e59f106f23828acf3e9147)), closes [#75](https://github.com/TheDeltaLab/merlin/issues/75)
* support custom host template in KubernetesApp ingress ([#79](https://github.com/TheDeltaLab/merlin/issues/79)) ([e359d37](https://github.com/TheDeltaLab/merlin/commit/e359d3723e0924469b74782a86f00f5ae583066a)), closes [#78](https://github.com/TheDeltaLab/merlin/issues/78)


### Bug Fixes

* add namespace to init templates and comment out unused secret refs ([#74](https://github.com/TheDeltaLab/merlin/issues/74)) ([79d897f](https://github.com/TheDeltaLab/merlin/commit/79d897ff7d39e217683a47f5f83651a31b4b1f21)), closes [#73](https://github.com/TheDeltaLab/merlin/issues/73)
* add oauth2-proxy email claim config to template and docs ([#81](https://github.com/TheDeltaLab/merlin/issues/81)) ([90cbe26](https://github.com/TheDeltaLab/merlin/commit/90cbe26fbc53d3327027ffe437fb12ae7aa62417)), closes [#80](https://github.com/TheDeltaLab/merlin/issues/80)

## [1.7.3](https://github.com/TheDeltaLab/merlin/compare/v1.7.2...v1.7.3) (2026-04-07)


### Bug Fixes

* resolve SP displayName ParamValue, cookie secret length, and CI SP permissions ([#71](https://github.com/TheDeltaLab/merlin/issues/71)) ([6fd9d3d](https://github.com/TheDeltaLab/merlin/commit/6fd9d3d529d95b8a2da968c7699ef4cd6f0e7d79)), closes [#70](https://github.com/TheDeltaLab/merlin/issues/70)

## [1.7.2](https://github.com/TheDeltaLab/merlin/compare/v1.7.1...v1.7.2) (2026-04-03)


### Bug Fixes

* copy CI-generated .npmrc for private registry auth in --ignore-workspace mode ([#63](https://github.com/TheDeltaLab/merlin/issues/63)) ([e9c665f](https://github.com/TheDeltaLab/merlin/commit/e9c665f7b2a951421d9ce165a3e4a2b85fd9b766))
* use getDisplayName() for SP principal ID lookup in authProvider ([#64](https://github.com/TheDeltaLab/merlin/issues/64)) ([b74ecd5](https://github.com/TheDeltaLab/merlin/commit/b74ecd5ed9d23cdc0a3f61d2b83c6240fce54924))

## [1.7.1](https://github.com/TheDeltaLab/merlin/compare/v1.7.0...v1.7.1) (2026-04-03)


### Bug Fixes

* throw on empty captured variables instead of silently skipping ([#61](https://github.com/TheDeltaLab/merlin/issues/61)) ([0a637a7](https://github.com/TheDeltaLab/merlin/commit/0a637a7fbea300874b8be4357c444861b31d4107)), closes [#60](https://github.com/TheDeltaLab/merlin/issues/60)

## [1.7.0](https://github.com/TheDeltaLab/merlin/compare/v1.6.0...v1.7.0) (2026-04-03)


### Features

* K8s-only deploy, directory roles, pnpm fixes, and init docs ([#58](https://github.com/TheDeltaLab/merlin/issues/58)) ([ee44802](https://github.com/TheDeltaLab/merlin/commit/ee448022a6a34a236a609668b67f7ad9b6ed160e))

## [1.6.0](https://github.com/TheDeltaLab/merlin/compare/v1.5.1...v1.6.0) (2026-04-02)


### Features

* add --k8s-only flag and skip K8s resources in pre-deploy RG creation ([#54](https://github.com/TheDeltaLab/merlin/issues/54)) ([859d564](https://github.com/TheDeltaLab/merlin/commit/859d564d40534c4485d06b3c20bcbf06e83a1019))

## [1.5.1](https://github.com/TheDeltaLab/merlin/compare/v1.5.0...v1.5.1) (2026-04-02)


### Bug Fixes

* --no-shared now compiles shared resources but skips deploying them ([#51](https://github.com/TheDeltaLab/merlin/issues/51)) ([83e9ae9](https://github.com/TheDeltaLab/merlin/commit/83e9ae91f9042b79fbf09e18f0c2294633aecd18))

## [1.5.0](https://github.com/TheDeltaLab/merlin/compare/v1.4.0...v1.5.0) (2026-04-02)


### Features

* auto-ensure K8s namespace exists before deploying resources ([#41](https://github.com/TheDeltaLab/merlin/issues/41)) ([4f0346c](https://github.com/TheDeltaLab/merlin/commit/4f0346c81bbfb0d7e8c3dab0cacde73ba487a5d0))
* modularize azure provider, improve CI/CD and onboarding ([#48](https://github.com/TheDeltaLab/merlin/issues/48)) ([0eb9dec](https://github.com/TheDeltaLab/merlin/commit/0eb9dec3dd676ddc2049f842a97d1a17dd06bb25))
* unified shared ACR and optional ring for global resources ([#44](https://github.com/TheDeltaLab/merlin/issues/44)) ([c3036d7](https://github.com/TheDeltaLab/merlin/commit/c3036d7a3cb5a10536a66dcd1eb07cd135ca9777))


### Bug Fixes

* resolve 26 compiler/integration test timeouts by mocking pnpm ([#46](https://github.com/TheDeltaLab/merlin/issues/46)) ([159a0c0](https://github.com/TheDeltaLab/merlin/commit/159a0c02ed42db7000646759829ae464a68a347b))

## [1.4.0](https://github.com/TheDeltaLab/merlin/compare/v1.3.0...v1.4.0) (2026-03-31)


### Features

* simplify CLI with merlin init, short names, deploy safety, and rename project ([#38](https://github.com/TheDeltaLab/merlin/issues/38)) ([1747903](https://github.com/TheDeltaLab/merlin/commit/174790397f21df0943a5b125daf751610a25adf6)), closes [#37](https://github.com/TheDeltaLab/merlin/issues/37)

## [1.3.0](https://github.com/TheDeltaLab/merlin/compare/v1.2.1...v1.3.0) (2026-03-30)


### Features

* add 'oidc' shorthand for apiPermissions in AzureServicePrincipal ([#35](https://github.com/TheDeltaLab/merlin/issues/35)) ([fd392b2](https://github.com/TheDeltaLab/merlin/commit/fd392b24fd82232b048d484dead097f487f0573b)), closes [#34](https://github.com/TheDeltaLab/merlin/issues/34)

## [1.2.1](https://github.com/TheDeltaLab/merlin/compare/v1.2.0...v1.2.1) (2026-03-30)


### Bug Fixes

* copy .npmrc into .merlin/ for private registry auth ([#32](https://github.com/TheDeltaLab/merlin/issues/32)) ([2a2d58b](https://github.com/TheDeltaLab/merlin/commit/2a2d58b3c107318a7e6ac63a193b10d08f7f5640))

## [1.2.0](https://github.com/TheDeltaLab/merlin/compare/v1.1.0...v1.2.0) (2026-03-30)


### Features

* add cookieSecretKeyVault for automated cookie secret generation ([#30](https://github.com/TheDeltaLab/merlin/issues/30)) ([024a7ed](https://github.com/TheDeltaLab/merlin/commit/024a7ede9207bbf06bee8acdf6868fa4edbedfb4))

## [1.1.0](https://github.com/TheDeltaLab/merlin/compare/v1.0.0...v1.1.0) (2026-03-30)


### Features

* add AKS RBAC Writer role for GitHub SP and update docs ([50ca854](https://github.com/TheDeltaLab/merlin/commit/50ca854eee15ff3b76e3a1b6adf7236693288217))
* add AKS roles to test SP for nightly K8s deploys ([d4b1de1](https://github.com/TheDeltaLab/merlin/commit/d4b1de1bf7590cb88f133759be1d4ce765b1edb1))
* Add declarative client secrets and Key Vault secrets ([2677627](https://github.com/TheDeltaLab/merlin/commit/2677627223fbb840f7d1ea69167131b66b62e1a1))
* add declarative client secrets and Key Vault secrets support ([155d992](https://github.com/TheDeltaLab/merlin/commit/155d992e0fc8366aec6f53663647409dd0f1c4cc)), closes [#26](https://github.com/TheDeltaLab/merlin/issues/26)
* add values object support to KubernetesHelmRelease ([47805e9](https://github.com/TheDeltaLab/merlin/commit/47805e96fd0541b4b772ea85373649244f5e3ece))
* support region:none, KubernetesApp composite type, and enhanced AzureServicePrincipal ([bd0a707](https://github.com/TheDeltaLab/merlin/commit/bd0a707e902d31660c355c55f694d9b6de751958))

## 1.0.0 (2026-03-28)


### Features

* automate releases with release-please ([d5ef7cb](https://github.com/TheDeltaLab/merlin/commit/d5ef7cbf7db7a59e233a8eab86bc461575754635))
* health probes, EasyAuth, custom domain binding, NS delegation, AD App client ID fix ([db7d2c8](https://github.com/TheDeltaLab/merlin/commit/db7d2c803e97200c05c801495222307558827c4d))
* health probes, EasyAuth, DNS binding, NS delegation, AD App client ID fix ([55291e7](https://github.com/TheDeltaLab/merlin/commit/55291e7f47a7f305312c3e0a7b8e3fcdd38061c8))
* migrate from ACA to AKS with full Kubernetes resource support ([6c1ea8a](https://github.com/TheDeltaLab/merlin/commit/6c1ea8afe84846e8803c8216ee20d4df5a34a0b7)), closes [#20](https://github.com/TheDeltaLab/merlin/issues/20)
* publish as @thedeltalab/merlin npm package, remove trinity resources ([1ca480b](https://github.com/TheDeltaLab/merlin/commit/1ca480b6fb08d66f783b21a2d7ba029b96034a85))


### Bug Fixes

* DNS zone RG creation, ACA hostname bind timing, and array CLI args ([51255cc](https://github.com/TheDeltaLab/merlin/commit/51255cc5f30b7594827e7ff8fdbd918545a34be5))
