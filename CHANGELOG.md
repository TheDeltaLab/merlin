# Changelog

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
