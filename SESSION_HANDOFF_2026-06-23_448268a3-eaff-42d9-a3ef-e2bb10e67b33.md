# Session Handoff — 2026-06-23

## Session Metadata

- Session ID: `448268a3-eaff-42d9-a3ef-e2bb10e67b33`
- Saved At (MT): `2026-06-23 16:30:46 MDT`
- Saved At (UTC): `2026-06-23T22:30:46.713Z`
- Summary: 2026-06-23 16:30:46 MDT | 448268a3-eaff-42d9-a3ef-e2bb10e67b33 | please find the 3 or 4 sessions we just dropped
- Runtime: `claude`
- Repo Root: `/home/runner/workspace`
- Thread CWD: `/home/runner/workspace`
- Transcript Path: `/home/runner/.claude/projects/-home-runner-workspace/448268a3-eaff-42d9-a3ef-e2bb10e67b33.jsonl`
- Branch: `main`
- HEAD: `58c63e85f725d65755674af9a805efeb8506e757`
- Latest Commit: `fix(signal-monitor): advance bar metadata when preserving a newer signal`
- Latest Commit Session ID: `unknown`
- Title: please find the 3 or 4 sessions we just dropped
- Model: `claude-opus-4-8`
- Reasoning Effort: `unknown`
- Tokens Used: `unknown`

## Current User Request

please find the 3 or 4 sessions we just dropped

## Latest Update — 2026-06-23 16:37:21 MDT

- User reported the Algo control panel Save function still spun / did not work and asked for live testing.
- Observed with no-safe Playwright on the running app: changing Signal Options `minBid` from `0.02` to `0.03` initially sent the PATCH quickly but took about `7.79s` to return while app-root `/api/signal-monitor/events?limit=1000...` history pagination and long-lived streams were active.
- Root cause narrowed further: the Save mutation was fighting same-origin Vite/API stream connection slots and then waiting on React Query cancellation. Direct API calls to `http://127.0.0.1:8080` were much faster than same-origin app calls.
- Fix added:
  - `lib/api-client-react/src/custom-fetch.ts` now supports per-request `baseUrl`.
  - Algo profile/strategy save mutations use `VITE_PROXY_API_TARGET` as a direct API base when present, so save writes use `127.0.0.1:8080` instead of the Vite proxy origin.
  - `AlgoScreen.jsx` begins a critical mutation pause, cancels root signal-monitor event history without awaiting it, drains briefly, and then saves.
  - `PlatformApp.jsx` disables root 36-hour signal-monitor event history on the Algo screen and during critical API mutation pauses.
  - `PlatformShell.jsx` gates the shell Algo cockpit stream during critical API mutation pauses.
- Live validation after fix:
  - Browser Save flow changed `minBid` `0.02 -> 0.03`, observed PATCH host `127.0.0.1:8080`, final save bar `All changes saved`, then restored `minBid` to `0.02`.
  - In-page click timing: PATCH request started after `1387ms`, response at `2542ms`, no `/api/signal-monitor/events` during Save.
- Validation passed:
  - `../../node_modules/.pnpm/node_modules/.bin/tsx --test ../../lib/api-client-react/src/custom-fetch.test.mjs src/features/platform/algoEventToasts.test.mjs src/features/platform/MarketDataSubscriptionProvider.test.mjs src/features/platform/PlatformAlgoMonitorSidebar.test.mjs src/app/AppContent.preloadContention.test.mjs src/screens/AlgoScreen.test.mjs src/screens/algo/saveAllAlgoAdjustments.test.mjs src/screens/algo/OperationsSignalTable.test.mjs src/screens/algo/algoTimeframeControls.test.mjs src/screens/algo/algoHelpers.test.mjs src/screens/algo/AlgoLivePage.test.mjs src/features/signals/signalsRowModel.test.mjs` — 141/141 passed.
  - `pnpm --filter @workspace/pyrus run typecheck` — passed.
- Known follow-up: the previous outside audit still flagged deployment-repair concerns unrelated to the now-validated save path: broad legacy overnight deployment merge risk and generic execution-event indexing. Address before landing the deployment-repair slice.

## Prior Handoffs

- `SESSION_HANDOFF_2026-06-23_b7565900-4439-49ff-a140-77a89f5b2618.md`
- `SESSION_HANDOFF_2026-06-23_b2737a45-9d93-4f58-bcf4-a4bd57d37ad7.md`
- `SESSION_HANDOFF_2026-06-23_a5137a42-097a-48cf-864c-cd9ac65b4cab.md`
- `SESSION_HANDOFF_2026-06-23_a2f03216-01b2-475c-a198-ff3158b5fadd.md`
- `SESSION_HANDOFF_2026-06-23_93084a11-33e5-4b19-b7b2-4e8c272608ec.md`
- `SESSION_HANDOFF_2026-06-23_43e47bfc-4de9-4f06-a0ca-86d20fca55e2.md`
- `SESSION_HANDOFF_2026-06-23_2d4a08d7-3605-48cc-be52-c0af8e69e01c.md`
- `SESSION_HANDOFF_2026-06-23_019ef5e1-d28b-7580-9105-9a219848cc6f.md`
- `SESSION_HANDOFF_2026-06-23_019ef5cd-598f-7423-ae59-359c11bd3155.md`
- `SESSION_HANDOFF_2026-06-23_019ef5cb-2c48-7ac2-a442-80c8289be0b0.md`
- `SESSION_HANDOFF_2026-06-23_019ef5bf-be20-7bd1-872e-669db64fa525.md`
- `SESSION_HANDOFF_2026-06-23_019ef5b5-9ab2-7b71-a8fa-aa72e5e6bd72.md`
- `SESSION_HANDOFF_2026-06-23_019ef5b5-91df-7d32-8a1b-a6c0ac3a07c9.md`
- `SESSION_HANDOFF_2026-06-23_019ef5b5-9037-7ee0-86e0-1a5d232d704c.md`
- `SESSION_HANDOFF_2026-06-23_019ef59c-0a1b-72d1-8ab2-dea7286aa787.md`
- `SESSION_HANDOFF_2026-06-23_019ef58d-7a62-7ec3-afa0-9be04480c0e0.md`
- `SESSION_HANDOFF_2026-06-23_019ef585-076c-7241-90d2-c1119be71962.md`
- `SESSION_HANDOFF_2026-06-23_019ef57d-9248-7872-bbc2-cbdaa64d23ef.md`
- `SESSION_HANDOFF_2026-06-23_019ef579-7253-7ad1-a8ce-ebfd073ee513.md`
- `SESSION_HANDOFF_2026-06-23_019ef558-015f-79d2-9f29-541e026a8d57.md`
- `SESSION_HANDOFF_2026-06-23_019ef553-323d-70e1-a1f4-f26c35878376.md`
- `SESSION_HANDOFF_2026-06-23_019ef553-1800-7793-a171-35e10a577ee6.md`
- `SESSION_HANDOFF_2026-06-23_019ef553-003d-7813-92e3-1cab63e7c332.md`
- `SESSION_HANDOFF_2026-06-23_019ef54a-f039-7bd1-a68c-b751588f8a44.md`
- `SESSION_HANDOFF_2026-06-23_019ef4e0-e9ef-7530-9683-02fdedd1353e.md`
- `SESSION_HANDOFF_2026-06-23_019ef4df-4e03-7853-8188-58678a0c002e.md`
- `SESSION_HANDOFF_2026-06-23_019ef1fc-9ac8-7152-a297-82bd1ecb962e.md`
- `SESSION_HANDOFF_2026-06-23_003c963e-84d5-4d54-a635-b1be93d07af8.md`
- `SESSION_HANDOFF_2026-06-22_ea53db29-10af-439e-8202-689f9a32d702.md`
- `SESSION_HANDOFF_2026-06-22_d187047c-6b3e-49a9-90dc-523ec2d9d062.md`
- `SESSION_HANDOFF_2026-06-22_cc510f0f-d1eb-4fcd-a0d9-e0f3bec5c378.md`
- `SESSION_HANDOFF_2026-06-22_bb452c23-0954-4fa7-86f9-4931e966d11b.md`
- `SESSION_HANDOFF_2026-06-22_b32152c8-6f81-42fe-b9d5-dbdf7a39c334.md`
- `SESSION_HANDOFF_2026-06-22_a2e66210-5eb6-421b-805f-278af0fc9a12.md`
- `SESSION_HANDOFF_2026-06-22_9d42f0f9-7a02-4b94-bb3c-57502fae54df.md`
- `SESSION_HANDOFF_2026-06-22_8e8312c6-410f-4696-8d7f-9f88de8f09ae.md`
- `SESSION_HANDOFF_2026-06-22_8bdb8f38-7cdb-4c8d-8795-d7e026fcea6a.md`
- `SESSION_HANDOFF_2026-06-22_8a4e761d-02c1-421e-83ec-ee27cce9fa12.md`
- `SESSION_HANDOFF_2026-06-22_7b37c814-b4cb-48c6-98e1-7d5678d6fc70.md`
- `SESSION_HANDOFF_2026-06-22_6cfc8e90-7fbe-431c-bf8f-bf1d4453554d.md`
- `SESSION_HANDOFF_2026-06-22_5bcf7f2f-1829-4289-812b-c3e9b079c218.md`
- `SESSION_HANDOFF_2026-06-22_4ccb1b0a-9fa0-4e9c-8f14-784936962abe.md`
- `SESSION_HANDOFF_2026-06-22_426c0f63-ef73-4538-a9bb-e82e66e0e34d.md`
- `SESSION_HANDOFF_2026-06-22_3dc49906-f7c1-4ea7-8047-42d11b451386.md`
- `SESSION_HANDOFF_2026-06-22_25851ae9-88ea-488e-8b65-65d6cd97635b.md`
- `SESSION_HANDOFF_2026-06-22_05de08b9-412a-433f-a1e1-33040f5a9a33.md`
- `SESSION_HANDOFF_2026-06-22_019ef0af-0e6f-7440-9a9b-38e0015449a3.md`
- `SESSION_HANDOFF_2026-06-22_019ef0ac-dd0c-7612-8e1d-ccd88c8e9637.md`
- `SESSION_HANDOFF_2026-06-22_000d4c5f-05da-41a2-814c-01cdb7901cab.md`
- `SESSION_HANDOFF_2026-06-20_e2aa841e-93f1-4c0a-bc50-358fd26ee959.md`
- `SESSION_HANDOFF_2026-06-20_456c1922-282c-4b81-98d5-2cd64d2f744a.md`
- `SESSION_HANDOFF_2026-06-20_43f05484-646a-41db-91cd-a768c81f63d8.md`
- `SESSION_HANDOFF_2026-06-19_a8529e14-e2e0-44d8-a710-878611fd0f64.md`
- `SESSION_HANDOFF_2026-06-19_a8133c2b-0761-4fea-a385-868fa277c6a9.md`
- `SESSION_HANDOFF_2026-06-19_3eeff6fe-c382-4b00-8801-a3f7f6c4a278.md`
- `SESSION_HANDOFF_2026-06-19_0d3c26f5-e062-4cec-a5e8-e0452308fcc9.md`
- `SESSION_HANDOFF_2026-06-18_f27a5bdf-5f01-4c4a-a7bc-04eff1e2814d.md`
- `SESSION_HANDOFF_2026-06-18_e8028ed2-2944-422e-bbb7-efcb2868cda4.md`
- `SESSION_HANDOFF_2026-06-18_d85f367c-bbe2-46e9-a043-e3f135daf049.md`
- `SESSION_HANDOFF_2026-06-18_a890231f-4df5-4855-8fde-f9f983ff7c22.md`
- `SESSION_HANDOFF_2026-06-18_9129c97a-b931-4e07-b557-145f0b9b0890.md`
- `SESSION_HANDOFF_2026-06-18_8da8b90f-2729-47e7-8d6b-25153f00942d.md`
- `SESSION_HANDOFF_2026-06-18_7e66de49-27d9-4346-acf6-df8cc9916e7e.md`
- `SESSION_HANDOFF_2026-06-18_6c8912b8-797f-4256-964c-b3a82c42ec16.md`
- `SESSION_HANDOFF_2026-06-18_6239259a-1e67-44f6-82d4-d8fbf0cf2d59.md`
- `SESSION_HANDOFF_2026-06-18_52ffc029-6478-475a-9be7-2d5df41c981e.md`
- `SESSION_HANDOFF_2026-06-18_4af95d4d-c55f-454c-9304-719274af55e0.md`
- `SESSION_HANDOFF_2026-06-18_45931117-3304-4b9c-8f4c-cdb8a8d46345.md`
- `SESSION_HANDOFF_2026-06-18_019edc3c-a227-7cc3-b881-3364fb79811b.md`
- `SESSION_HANDOFF_2026-06-18_019edc31-6802-7df0-b2d2-9ecdf81730c4.md`
- `SESSION_HANDOFF_2026-06-18_019edc31-67b3-79f3-9c73-93da5cf623d5.md`
- `SESSION_HANDOFF_2026-06-18_019edc2a-2017-76d3-a931-13ab8bf234c2.md`
- `SESSION_HANDOFF_2026-06-18_019edc10-582a-7f03-9ac7-28a99740b6ae.md`
- `SESSION_HANDOFF_2026-06-18_019edc09-6d1d-71c2-b1ff-63986e98ff90.md`
- `SESSION_HANDOFF_2026-06-18_019edc06-0823-7311-8184-f70df238e2c1.md`
- `SESSION_HANDOFF_2026-06-18_019edc01-6e6b-7091-89b7-f37f3e1c2789.md`
- `SESSION_HANDOFF_2026-06-18_019edbff-2b98-7102-b00a-d3db4e96b4c8.md`
- `SESSION_HANDOFF_2026-06-18_019edbf9-4e92-7061-9d93-fb29dee6b0ad.md`
- `SESSION_HANDOFF_2026-06-18_019edbed-ef39-7340-8cb6-0a235ac17001.md`
- `SESSION_HANDOFF_2026-06-18_019edbed-5067-79c1-b3d5-174a9b0eb6dd.md`
- `SESSION_HANDOFF_2026-06-18_019edbe4-8452-74f0-a755-26181ad5e7c4.md`
- `SESSION_HANDOFF_2026-06-18_019edbd2-5aa9-7ab2-9a77-d7d5c43cae22.md`
- `SESSION_HANDOFF_2026-06-18_019edb3a-9ef1-75b3-b443-16be2acafd06.md`
- `SESSION_HANDOFF_2026-06-18_019edb32-7193-7d71-8fce-7826d9ea8fc4.md`
- `SESSION_HANDOFF_2026-06-18_019edb16-2f58-78a3-9b4e-e8c254794fdd.md`
- `SESSION_HANDOFF_2026-06-18_019edb16-147e-7b10-8c0d-1d40518d76ad.md`
- `SESSION_HANDOFF_2026-06-18_019edb15-ec5d-7013-af74-21fe7c0ec961.md`
- `SESSION_HANDOFF_2026-06-18_019edb15-cd8b-73d0-b8f9-d072b7b88eb5.md`
- `SESSION_HANDOFF_2026-06-18_019edaf5-c14e-7ce3-a056-9450b42e9bd7.md`
- `SESSION_HANDOFF_2026-06-17_ff8a6f9d-4207-4263-a9a2-de865f5f7ca0.md`
- `SESSION_HANDOFF_2026-06-17_f75a3d2e-c93c-472b-9aad-8faa3e573939.md`
- `SESSION_HANDOFF_2026-06-17_f1cad8b4-b092-4dc7-b0fb-608d1b5475f3.md`
- `SESSION_HANDOFF_2026-06-17_d3be8676-affe-42f4-8351-992d88fb2199.md`
- `SESSION_HANDOFF_2026-06-17_cb025ae0-6840-4292-ad90-cd623532fc02.md`
- `SESSION_HANDOFF_2026-06-17_c26f5b4e-e826-4607-a578-98a0977f1c32.md`
- `SESSION_HANDOFF_2026-06-17_bca66aa5-d3f4-4bdf-a82b-0daafde50592.md`
- `SESSION_HANDOFF_2026-06-17_b813ef30-05c0-40ee-b347-cd5b2218920e.md`
- `SESSION_HANDOFF_2026-06-17_b2a29e96-6d0f-409d-8f40-a54d873a1325.md`
- `SESSION_HANDOFF_2026-06-17_a9733916-4b87-4cd5-81bc-806d9688ab32.md`
- `SESSION_HANDOFF_2026-06-17_a6774ebd-5e60-4b55-8ba4-2066b7f68527.md`
- `SESSION_HANDOFF_2026-06-17_8a2a0c96-efd0-4128-8fc6-b872d407ea12.md`
- `SESSION_HANDOFF_2026-06-17_69f30069-ed04-4d1f-842d-d5036a97c509.md`
- `SESSION_HANDOFF_2026-06-17_68198fd8-e6b1-464d-bb36-994693ba89e1.md`
- `SESSION_HANDOFF_2026-06-17_597ef7e5-ca7e-4909-a190-5ab85027cde8.md`
- `SESSION_HANDOFF_2026-06-17_53a63210-b225-4826-861e-c89903e843f4.md`
- `SESSION_HANDOFF_2026-06-17_44004638-9aef-48a0-a34b-4b34acf36bc3.md`
- `SESSION_HANDOFF_2026-06-17_2669c167-4fe7-4a2e-a4bc-a48fbcd10a7e.md`
- `SESSION_HANDOFF_2026-06-17_23fcc214-5a16-4076-966e-bba8113f4c4a.md`
- `SESSION_HANDOFF_2026-06-17_07e94cd6-007f-4489-933d-f5b7644812d5.md`
- `SESSION_HANDOFF_2026-06-17_03c14e8a-b4cc-47a8-8c9e-6dd7f7ccfa40.md`
- `SESSION_HANDOFF_2026-06-17_019ed86a-06be-7c03-88b2-b81c8de1474e.md`
- `SESSION_HANDOFF_2026-06-17_019ed72d-01cd-7c50-be55-13b49af4f5f1.md`
- `SESSION_HANDOFF_2026-06-17_019ed722-d363-7ed0-ae0c-cc9fdfef2095.md`
- `SESSION_HANDOFF_2026-06-17_019ed6f5-e82f-7343-8ef0-858fbf4f02ac.md`
- `SESSION_HANDOFF_2026-06-16_dc790051-58ca-411d-b656-51487f9860da.md`
- `SESSION_HANDOFF_2026-06-16_d6046da4-048f-4c5f-b7f4-ca9b10614176.md`
- `SESSION_HANDOFF_2026-06-16_ca3b3d1f-8c38-4868-948c-3b33a40cb361.md`
- `SESSION_HANDOFF_2026-06-16_a84e5c1d-d658-4bb5-9f42-9e8568f49bbf.md`
- `SESSION_HANDOFF_2026-06-16_a110ef2f-bff5-445b-aabe-ae62b2b2351d.md`
- `SESSION_HANDOFF_2026-06-16_7ce8ad71-98bf-40ef-ae04-348c7793e03e.md`
- `SESSION_HANDOFF_2026-06-16_68174ada-00d2-4cc9-9df3-541a6eb472fe.md`
- `SESSION_HANDOFF_2026-06-16_394cdc7a-fc80-4f09-9cab-253fecf90c55.md`
- `SESSION_HANDOFF_2026-06-16_32b4c343-3c61-4a5a-871a-77edb3577003.md`
- `SESSION_HANDOFF_2026-06-16_2ed1ee06-6a10-47c9-bb60-b7684084002a.md`
- `SESSION_HANDOFF_2026-06-16_2b331249-f38b-40d0-b8bc-5379c6f1e5ec.md`
- `SESSION_HANDOFF_2026-06-13_019ec132-92d0-78c1-a21c-4f5d378afa46.md`
- `SESSION_HANDOFF_2026-06-12_019ebe12-b4b7-7281-95b2-698b1d4bfc05.md`
- `SESSION_HANDOFF_2026-06-12_019ebd74-8d06-7071-a225-67ce7a538918.md`
- `SESSION_HANDOFF_2026-06-12_019ebd74-85d5-71a1-8b64-7624988e5a5b.md`
- `SESSION_HANDOFF_2026-06-12_019ebd73-c854-73d0-99dd-2c4a8b381f19.md`
- `SESSION_HANDOFF_2026-06-12_019ebcc7-8221-7bd1-bae0-aeef66f2a47c.md`
- `SESSION_HANDOFF_2026-06-12_019ebc2a-0433-7f33-90eb-21fe32f49ab5.md`
- `SESSION_HANDOFF_2026-06-12_019ebbdd-48b3-7190-9048-c79405308314.md`
- `SESSION_HANDOFF_2026-06-12_019ebbd7-a838-7d13-a8d9-5d7897e14d0f.md`
- `SESSION_HANDOFF_2026-06-12_019ebbd5-43cd-7c81-87a4-de8ee2a46199.md`
- `SESSION_HANDOFF_2026-06-11_pending-sta-action-source-trace.md`
- `SESSION_HANDOFF_2026-06-11_019eb95b-6597-74d2-929d-76355493dfbd.md`
- `SESSION_HANDOFF_2026-06-11_019eb80c-7659-7300-92ce-22b8bd89275c.md`
- `SESSION_HANDOFF_2026-06-11_019eb80c-5d1b-7d03-a551-1ec17ef91788.md`
- `SESSION_HANDOFF_2026-06-11_019eb7fd-6cfb-7432-a96b-b65a23fee54d.md`
- `SESSION_HANDOFF_2026-06-11_019eb7fb-f024-78a2-9fc3-058529429d01.md`
- `SESSION_HANDOFF_2026-06-11_019eb7f1-23f6-7853-a3be-c4f5a00fce37.md`
- `SESSION_HANDOFF_2026-06-11_019eb7f0-feb4-75c0-a144-af7a7eda05f8.md`
- `SESSION_HANDOFF_2026-06-11_019eb7f0-db13-7a12-bd98-22efb8b7408a.md`
- `SESSION_HANDOFF_2026-06-11_019eb7f0-ba1a-72f2-9be4-b9b0c91c873c.md`
- `SESSION_HANDOFF_2026-06-11_019eb7ee-d363-7d01-bec6-79361d86915a.md`
- `SESSION_HANDOFF_2026-06-11_019eb7e8-b0e1-7a63-aa86-8fde89eac69c.md`
- `SESSION_HANDOFF_2026-06-11_019eb7d7-c610-76c1-9b43-25a82e66e5e2.md`
- `SESSION_HANDOFF_2026-06-11_019eb7d0-5bce-75a3-8f85-74b2c38225fa.md`
- `SESSION_HANDOFF_2026-06-11_019eb7c2-9c54-7870-8152-e6f9a6f9be6b.md`
- `SESSION_HANDOFF_2026-06-11_019eb7b4-d4bd-7573-adf9-ae184361696f.md`
- `SESSION_HANDOFF_2026-06-11_019eb7b2-4b1e-7160-9796-b203f9392d27.md`
- `SESSION_HANDOFF_2026-06-11_019eb7a8-d0bc-7910-a8b5-aafaf1750bc1.md`
- `SESSION_HANDOFF_2026-06-11_019eb7a8-9ba6-7ad1-9555-e8b647c6c363.md`
- `SESSION_HANDOFF_2026-06-11_019eb7a3-d912-7ec3-8667-3c8c83630d72.md`
- `SESSION_HANDOFF_2026-06-11_019eb788-9135-7151-a47f-38a32fe28fa5.md`
- `SESSION_HANDOFF_2026-06-11_019eb77c-c335-7290-8f57-822c79025541.md`
- `SESSION_HANDOFF_2026-06-10_019eb3df-e2f3-73f1-bb4c-18d95c4a5075.md`
- `SESSION_HANDOFF_2026-06-09_019eaea5-da22-7eb0-b361-dd2339bb136a.md`
- `SESSION_HANDOFF_2026-06-09_019eae66-0e88-7431-82ce-e7909cea1b55.md`
- `SESSION_HANDOFF_2026-06-09_019eae19-7225-7e60-8c45-e32bd10b2c21.md`
- `SESSION_HANDOFF_2026-06-09_019eae05-eacb-7d50-a8dd-8323ada25d22.md`
- `SESSION_HANDOFF_2026-06-09_019eae02-420b-7fa1-953a-b1abcc2622bd.md`
- `SESSION_HANDOFF_2026-06-09_019eadfc-2cd0-78f2-b041-bbb600dbade3.md`
- `SESSION_HANDOFF_2026-06-09_019eade0-4046-70c3-975d-0cc3b0aee56a.md`
- `SESSION_HANDOFF_2026-06-09_019eade0-0422-7320-bbc6-22643066d321.md`
- `SESSION_HANDOFF_2026-06-09_019eadd8-e8e2-70c2-a7ff-fb5eefa135a4.md`
- `SESSION_HANDOFF_2026-06-09_019eadd4-25b3-7b52-949e-eda0aa2eafa7.md`
- `SESSION_HANDOFF_2026-06-09_019eadc4-e336-7472-87f1-7f6600f9b4b7.md`
- `SESSION_HANDOFF_2026-06-09_019ead78-0a4d-79c0-8333-f9e67135e8ca.md`
- `SESSION_HANDOFF_2026-06-09_019ead4a-2fc8-7b61-a989-2a78762f17c2.md`
- `SESSION_HANDOFF_2026-06-09_019ead39-ed30-7151-916c-188f0a0c305d.md`
- `SESSION_HANDOFF_2026-06-09_019eac9c-ec03-7de1-98f0-6421d5d8312a.md`
- `SESSION_HANDOFF_2026-06-08_019eaac8-99ba-7072-9412-bf2eb1070bed.md`
- `SESSION_HANDOFF_2026-06-08_019eaab5-1b86-7c60-875f-67b54a909239.md`
- `SESSION_HANDOFF_2026-06-08_019eaa48-a445-7482-8aa5-21d669524581.md`
- `SESSION_HANDOFF_2026-06-08_019eaa48-3cb6-7290-a56f-99c4a4af2d32.md`
- `SESSION_HANDOFF_2026-06-08_019ea975-0cde-7cd2-a5bc-4892aee272c4.md`
- `SESSION_HANDOFF_2026-06-08_019ea847-b017-7b53-a789-ccec852acccc.md`
- `SESSION_HANDOFF_2026-06-08_019ea81a-ebe7-7642-a873-09562ba0de35.md`
- `SESSION_HANDOFF_2026-06-08_019ea81a-819e-7841-9d0f-1e9a601a4691.md`
- `SESSION_HANDOFF_2026-06-08_019ea814-21e3-7672-9b64-7eeae3ff07d2.md`
- `SESSION_HANDOFF_2026-06-08_019ea813-0e32-7543-ab00-303e24d7008a.md`
- `SESSION_HANDOFF_2026-06-08_019ea812-8281-75d2-b082-8e5b5be596db.md`
- `SESSION_HANDOFF_2026-06-08_019ea765-6876-7d92-80df-62338c1ffa87.md`
- `SESSION_HANDOFF_2026-06-08_019ea72c-b88f-7f52-9b85-87faa59c57e5.md`
- `SESSION_HANDOFF_2026-06-08_019ea4a9-b0c1-70e0-aa79-7f3fc45be403.md`
- `SESSION_HANDOFF_2026-06-07_019ea43b-d49a-7f52-b5c9-d587e6c6040c.md`
- `SESSION_HANDOFF_2026-06-07_019ea437-deef-7981-9fe7-82c12513ffde.md`
- `SESSION_HANDOFF_2026-06-06_019e9de4-91e7-72b0-8853-3f70fd908c3e.md`
- `SESSION_HANDOFF_2026-06-06_019e9ddc-1936-7d52-a57b-de5e92b1a11e.md`
- `SESSION_HANDOFF_2026-06-06_019e9d7d-0f96-7750-9f11-dd41d293e473.md`
- `SESSION_HANDOFF_2026-06-06_019e9d7b-30c5-7502-b87c-0ac35e2d4f6f.md`
- `SESSION_HANDOFF_2026-06-05_signal-bubble-pending-hydration.md`
- `SESSION_HANDOFF_2026-06-05_semantic-tone-rollout.md`
- `SESSION_HANDOFF_2026-06-05_019e9a07-2756-7dc0-87c1-f22ac5fc79db.md`
- `SESSION_HANDOFF_2026-06-05_019e9a00-0ec7-7531-ba91-041f6bd63385.md`
- `SESSION_HANDOFF_2026-06-05_019e99c5-dd2d-7000-a813-5d649c3f3428.md`
- `SESSION_HANDOFF_2026-06-05_019e9923-d8b9-7fc1-91d6-02a81091fe1e.md`
- `SESSION_HANDOFF_2026-06-05_019e9923-c551-74c0-8f7a-4f4419b923ee.md`
- `SESSION_HANDOFF_2026-06-05_019e9923-1b8d-7cb0-9f8e-8cd49d80292a.md`
- `SESSION_HANDOFF_2026-06-04_019e953f-041b-71c3-a43e-542a8ef6e00d.md`
- `SESSION_HANDOFF_2026-06-04_019e9539-fcdb-7352-ba37-146876d76a81.md`
- `SESSION_HANDOFF_2026-06-04_019e9539-e3ff-7141-9ec2-b2bdd077e69e.md`
- `SESSION_HANDOFF_2026-06-04_019e9538-ef1f-70c0-9659-e0ad9176a023.md`
- `SESSION_HANDOFF_2026-06-04_019e94a9-bc59-7e40-93d2-8f113348cca2.md`
- `SESSION_HANDOFF_2026-06-04_019e940a-cceb-7790-889f-d5534cc0814c.md`
- `SESSION_HANDOFF_2026-06-04_019e934b-5d2a-7ab2-8676-71145b8a4c03.md`
- `SESSION_HANDOFF_2026-06-04_019e92c2-ff99-78e0-a36f-3ddb9c03a700.md`
- `SESSION_HANDOFF_2026-06-04_019e92c1-77d0-7fd0-b7e3-01bb797e2227.md`
- `SESSION_HANDOFF_2026-06-03_mtf-entry-sweep-ui.md`
- `SESSION_HANDOFF_2026-06-03_019e909f-4ab7-7f32-9321-237e31de2032.md`
- `SESSION_HANDOFF_2026-06-03_019e9091-8f8f-75c0-be2c-f9ccbaa788b4.md`
- `SESSION_HANDOFF_2026-06-03_019e9071-13a9-7603-a5fd-ed951f5273d5.md`
- `SESSION_HANDOFF_2026-06-03_019e906b-b44d-76d2-a8d5-020be84bba6e.md`
- `SESSION_HANDOFF_2026-06-03_019e9066-b78f-7160-b516-c85c2e7fe345.md`
- `SESSION_HANDOFF_2026-06-03_019e8ed9-7dcd-7812-982f-a2d96ed0676f.md`
- `SESSION_HANDOFF_2026-06-03_019e8ed7-2665-7a70-8107-953700380a4b.md`
- `SESSION_HANDOFF_2026-06-03_019e8e1a-67c0-7de1-a96e-f28098f0d355.md`
- `SESSION_HANDOFF_2026-06-03_019e8e19-f0f6-7a02-b8da-97fb302cf399.md`
- `SESSION_HANDOFF_2026-06-02_signals-timeframe-hydration.md`
- `SESSION_HANDOFF_2026-06-02_signal-bubbles-matrix-diagnosis.md`
- `SESSION_HANDOFF_2026-06-02_019e8afa-5620-70f1-a4b6-bf40e41e7aa5.md`
- `SESSION_HANDOFF_2026-06-02_019e8afa-4637-70b2-971a-b6a37b9539b7.md`
- `SESSION_HANDOFF_2026-06-02_019e8afa-10bc-76e0-96b3-1facd819d790.md`
- `SESSION_HANDOFF_2026-06-02_019e8ac2-edd3-7d53-b81e-2ee862972acc.md`
- `SESSION_HANDOFF_2026-06-02_019e8ac1-f364-7743-bee6-66c240b2b44d.md`
- `SESSION_HANDOFF_2026-06-02_019e8aaa-6793-77b1-90fc-1e053f373563.md`
- `SESSION_HANDOFF_2026-06-02_019e89ba-27c7-7560-804d-9a02b2a94b74.md`
- `SESSION_HANDOFF_2026-06-02_019e89b9-c29e-7541-baf7-7d9d4d5803fd.md`
- `SESSION_HANDOFF_2026-06-02_019e89a7-e15d-77f1-9820-862e90a38123.md`
- `SESSION_HANDOFF_2026-06-02_019e898a-b316-7df3-8842-2f179ad5d122.md`
- `SESSION_HANDOFF_2026-06-02_019e8972-55bb-7641-ab8b-02a041961ad6.md`
- `SESSION_HANDOFF_2026-06-02_019e8971-d31f-7720-9983-d413f637e126.md`
- `SESSION_HANDOFF_2026-06-02_019e8971-1dc4-75b2-9c36-4d78d5f75203.md`
- `SESSION_HANDOFF_2026-06-02_019e889a-133d-75f3-922f-fc54c144ea94.md`
- `SESSION_HANDOFF_2026-06-02_019e8897-3487-71b3-b357-5dcbc6b7ac6d.md`
- `SESSION_HANDOFF_2026-06-02_019e8870-4fd3-7130-aa12-b6324b163918.md`
- `SESSION_HANDOFF_2026-06-02_019e886f-b02b-70e1-8c40-018f3b7100e3.md`
- `SESSION_HANDOFF_2026-06-01_75218067-d9b9-4264-8b7a-3243c1a06ca1.md`
- `SESSION_HANDOFF_2026-06-01_019e862d-a38a-7a50-ab58-9801840e30fc.md`
- `SESSION_HANDOFF_2026-06-01_019e862c-7a64-7982-b62e-6ed0423a8457.md`
- `SESSION_HANDOFF_2026-06-01_019e8620-30a2-7792-8500-16c95843972c.md`
- `SESSION_HANDOFF_2026-06-01_019e8583-e862-7bb1-8560-5db3658c7345.md`
- `SESSION_HANDOFF_2026-06-01_019e856f-e49f-7fb0-941e-fd5c610c8e35.md`
- `SESSION_HANDOFF_2026-06-01_019e856e-bffa-7833-b2b7-da4c35f1f4ed.md`
- `SESSION_HANDOFF_2026-06-01_019e856e-09fe-7de1-b9bc-28878b14c985.md`
- `SESSION_HANDOFF_2026-06-01_019e856c-a253-71f2-9ad3-d53939c3f375.md`
- `SESSION_HANDOFF_2026-06-01_019e84ed-e068-7de2-ad5e-d900df7d26c1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-d2bd-7103-91a9-a73c9fcfb9c1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-83ed-7462-8cd5-1c29cc47fbd7.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-1f90-7b41-b68e-5b0b7120b56c.md`
- `SESSION_HANDOFF_2026-06-01_019e8411-18fc-7911-9c4d-4aeecba402ac.md`
- `SESSION_HANDOFF_2026-06-01_019e83a8-59ca-7843-b17d-1eb1b26d5363.md`
- `SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md`
- `SESSION_HANDOFF_2026-06-01_019e8368-7762-7122-81b8-8a37bfbb0e60.md`
- `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`
- `SESSION_HANDOFF_2026-06-01_019e8361-9248-72a3-9743-ffd530b4d55e.md`
- `SESSION_HANDOFF_2026-05-31_019e80a2-9969-70a2-a92d-39cf6a379925.md`
- `SESSION_HANDOFF_2026-05-31_019e8076-ad60-7ee3-9c89-87f101b7545a.md`
- `SESSION_HANDOFF_2026-05-31_019e802e-8fc0-77a0-8857-7f3208f84734.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-7aa8-7832-9d3b-d9a1f55357d2.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-21e9-7bf1-961a-4c205f226e9e.md`
- `SESSION_HANDOFF_2026-05-31_019e7ff7-d9da-7333-9c5f-43f9156a8d45.md`
- `SESSION_HANDOFF_2026-05-31_019e7fc7-29fb-7991-9d61-98d6224fb6da.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa4-ed2e-70e1-ac7f-a54fee386518.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md`
- `SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md`
- `SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md`
- `SESSION_HANDOFF_2026-05-31_019e7e9b-e240-7c30-98d2-a1ad94723f11.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-c715-7200-b4a6-1bb0adf72b13.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-1f10-7e00-9474-efbb5051b670.md`
- `SESSION_HANDOFF_2026-05-30_019e7a9a-5ec9-7eb3-95f1-d0c5503ed8a0.md`
- `SESSION_HANDOFF_2026-05-30_019e7a20-0e2f-73f1-ae20-ddf1fb495be5.md`
- `SESSION_HANDOFF_2026-05-30_019e7995-e4a1-7bf2-b6a0-339a98d29317.md`
- `SESSION_HANDOFF_2026-05-30_019e7994-2d67-7883-840f-7d3c3d92d721.md`
- `SESSION_HANDOFF_2026-05-29_019e752f-259e-7553-9866-4b0c4544dd05.md`
- `SESSION_HANDOFF_2026-05-29_019e752d-9895-7653-936f-31f010b764d5.md`
- `SESSION_HANDOFF_2026-05-29_019e752a-b590-79a3-a82b-ee464537fd82.md`
- `SESSION_HANDOFF_2026-05-29_019e7529-c353-7b83-a39a-5f8a0fe69745.md`
- `SESSION_HANDOFF_2026-05-29_019e7499-013e-7c80-ad40-9c917f319149.md`
- `SESSION_HANDOFF_2026-05-29_019e7442-882b-7a13-b625-d886421780aa.md`
- `SESSION_HANDOFF_2026-05-29_019e742a-a3f1-71b3-8374-b51029016cbf.md`
- `SESSION_HANDOFF_2026-05-29_019e7426-9371-7430-9a71-6686f1347001.md`
- `SESSION_HANDOFF_2026-05-29_019e7421-ba22-78a1-a721-7446ea362dd7.md`
- `SESSION_HANDOFF_2026-05-28_019e6f40-5f2f-78f1-afca-4032e91e55db.md`
- `SESSION_HANDOFF_2026-05-28_019e6f32-5565-76d0-8ae0-06b4e2e30a0e.md`
- `SESSION_HANDOFF_2026-05-28_019e6ea4-f32b-7261-8ca3-9d57cc9d40b5.md`
- `SESSION_HANDOFF_2026-05-27_019e6bbb-f865-7563-96f6-ede09cfc4167.md`
- `SESSION_HANDOFF_2026-05-26_019e654e-1409-7621-bde7-f8c231fda8d0.md`
- `SESSION_HANDOFF_2026-05-26_019e6477-7493-7191-acfb-8aa632788e6c.md`
- `SESSION_HANDOFF_2026-05-25_019e6049-463f-7ab0-a520-95e909a2eff6.md`
- `SESSION_HANDOFF_2026-05-22_019e509e-5038-7b20-a757-cf053441bc8d.md`
- `SESSION_HANDOFF_2026-05-22_019e5096-b2ce-7881-83b4-84fd5ae9aea9.md`
- `SESSION_HANDOFF_2026-05-22_019e4fde-9151-7940-a16a-b90a6bf12517.md`
- `SESSION_HANDOFF_2026-05-22_019e4fdd-cf2f-77a2-84e7-35d48584074b.md`
- `SESSION_HANDOFF_2026-05-22_019e4fd1-20ef-7931-9b08-e4cc646ccb00.md`
- `SESSION_HANDOFF_2026-05-21_019e4e27-3e58-7c51-a2ee-431ce0637c44.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5e-ddaa-7d22-90ff-4b3b56c16ab1.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5d-d653-7702-86a8-c20a83ee23ff.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5c-a277-71d0-afd5-4a740991a8c6.md`
- `SESSION_HANDOFF_2026-05-21_019e4c7a-19cf-7740-84f6-5eb3a1f36fae.md`
- `SESSION_HANDOFF_2026-05-21_019e4c26-0d56-7120-b85e-bf5e18f14721.md`
- `SESSION_HANDOFF_2026-05-21_019e4c16-3a66-7302-8ada-1206e23e11df.md`
- `SESSION_HANDOFF_2026-05-21_019e4c15-88e9-7a42-aad0-86eed917c98a.md`
- `SESSION_HANDOFF_2026-05-21_019e4c14-fe5e-7802-970c-bae01f8b7212.md`
- `SESSION_HANDOFF_2026-05-21_019e4acb-958e-76f2-89fc-f534179f2902.md`
- `SESSION_HANDOFF_2026-05-20_019e46ed-0bc3-78f3-bad7-f7ca24065531.md`
- `SESSION_HANDOFF_2026-05-20_019e45cf-44f8-7fe2-87f5-7d055c00513f.md`
- `SESSION_HANDOFF_2026-05-20_019e45ab-830c-76d1-8f63-448f25c8f681.md`
- `SESSION_HANDOFF_2026-05-20_019e45a3-68ab-7160-ab80-038d09482d6a.md`
- `SESSION_HANDOFF_2026-05-19_019e4057-cc09-7610-9cd5-2b159d78b023.md`
- `SESSION_HANDOFF_2026-05-14_019e26f3-cc37-7351-94a3-c52aae3be0c7.md`
- `SESSION_HANDOFF_2026-05-13_019e21ab-042e-7d62-82c5-621bb214aaf4.md`
- `SESSION_HANDOFF_2026-05-13_019e219a-97c1-7c81-a23d-86233b1a8ccc.md`
- `SESSION_HANDOFF_2026-05-13_019e2194-a0c5-7fd1-8c6e-f3fd3869af34.md`
- `SESSION_HANDOFF_2026-05-13_019e2191-5255-7b50-9d9d-d66432f7cc23.md`
- `SESSION_HANDOFF_2026-05-13_019e2168-cce7-7f22-8a53-a394d6279949.md`
- `SESSION_HANDOFF_2026-05-11_019e1777-ea5d-7a03-aa38-a7da139985d7.md`
- `SESSION_HANDOFF_2026-05-08_019e0920-564f-78d0-8463-410e50e52b5d.md`
- `SESSION_HANDOFF_2026-05-08_019e0826-0850-7bf2-8100-0b3eada42e32.md`
- `SESSION_HANDOFF_2026-05-06_019dff8b-c488-7ec1-bab2-7eeca931697f.md`
- `SESSION_HANDOFF_2026-05-06_019dff88-574a-74f3-8ead-27ea141dfd2f.md`
- `SESSION_HANDOFF_2026-05-06_019dff6f-d657-70a2-bed9-7c3a2469bed7.md`
- `SESSION_HANDOFF_2026-05-06_019dff68-fd69-7fd1-84aa-f97b89d2efe8.md`
- `SESSION_HANDOFF_2026-05-06_019dff67-f5a1-7332-8624-585ac4cd1435.md`
- `SESSION_HANDOFF_2026-05-06_019dff66-df3f-7bc1-abe4-39b68ed2dcff.md`
- `SESSION_HANDOFF_2026-05-06_019dfe4d-4d96-7552-80ac-346c0646adb1.md`
- `SESSION_HANDOFF_2026-05-06_019dfe49-d18c-7bd1-97d1-7e004ff154f0.md`
- `SESSION_HANDOFF_2026-05-06_019dfe45-759c-77c0-b66f-9cc21addb43b.md`
- `SESSION_HANDOFF_2026-05-06_019dfe1c-e228-72b2-932c-6d9faa06df81.md`

## Recent User Messages

- `2026-06-23 16:11:15 MDT` im noticing that the signal lane is not being filtered by the algo control panel. lets have that be a setting within the signals popover. questions?
- `2026-06-23 16:13:55 MDT` [Request interrupted by user for tool use]
- `2026-06-23 16:14:04 MDT` nvm on that lane change.
- `2026-06-23 16:15:40 MDT` lets task a new separate subagent with fixing any errantly stale signals.
- `2026-06-23 16:20:33 MDT` can you send a new and separate subagent to take a look our scoring system in the sta table - im seeing that our score is not predicting price direction as well as it should be. we should be updating our scoring system to the signals. /interview-me with questions before you send to subagent
- `2026-06-23 16:22:17 MDT` not sure, lets flesh this out togehter
- `2026-06-23 16:24:33 MDT` yes. we should have more than enough data to get a really good read on this
- `2026-06-23 16:25:44 MDT` <task-notification> <task-id>wbrholoyy</task-id> <tool-use-id>toolu_01UozVyNY2C2sZZe9k5SEXM1</tool-use-id> <output-file>/tmp/claude-1000/-home-runner-workspace/448268a3-eaff-42d9-a3ef-e2bb10e67b33/tasks/wbrholoyy.output</output-file> <status>completed</status> <summary>Dynamic workflow "Hunt for remaining pressure-related issues now that A+B1+B3 are live" completed</summary> <result>{"hunts":[{"area":"Live runtime forensics of residual DB-pool / backpressure load (flight-recorder pid 153437 + recent pids, 2026-06-23)","summary":"The dominant pool saturation is NOT solved in steady state — the \"live: dbPool 5/12 no waiters\" was a momentary read. Across the recent ~8 pids of 2026-06-23, 3150/3996 (79%) of api-db-query-slow events fired with the pool fully saturated (active=12), pool waiti…
- `2026-06-23 16:25:55 MDT` [Request interrupted by user]
- `2026-06-23 16:25:55 MDT` b
- `2026-06-23 16:27:00 MDT` yes a
- `2026-06-23 16:28:35 MDT` yes, dispatch the subagent

## Session Activity Summary

- `2026-06-23 13:08:51 MDT` User: please find the 3 or 4 sessions we just dropped
- `2026-06-23 13:08:55 MDT` Agent: I'll invoke the session-handoff skill, which is built for recovering dropped sessions.
- `2026-06-23 13:08:56 MDT` Tool: Skill {"skill":"session-handoff","args":"recover the 3-4 sessions we just dropped"}
- `2026-06-23 13:09:01 MDT` Agent: The user reports dropped sessions, so per the Dropped Session Recovery Rule I'll start with runtime/session-layer evidence, not repo handoff files. Let me sweep the Codex stores a…
- `2026-06-23 13:09:03 MDT` Tool: Bash echo "=== ~/.codex tree ==="; ls -la ~/.codex 2>/dev/null; echo "=== sessions dir ==="; ls -la ~/.codex/sessions 2>/dev/null | head; echo "=== state sqlite fil…
- `2026-06-23 13:09:05 MDT` Tool: Bash echo "=== recent rollout files (newest 15) ==="; find ~/.codex/sessions -name 'rollout-*.jsonl' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -15 | awk '{pr…
- … 539 lower-signal transcript events omitted …
- `2026-06-23 16:25:55 MDT` User: [Request interrupted by user]
- `2026-06-23 16:25:55 MDT` User: b
- `2026-06-23 16:26:31 MDT` Agent: Got it — **(b): grade on MFE > MAE** in the signal's direction. That matches my read; we'll label each historical signal favorable/adverse by its recorded excursion over the execu…
- `2026-06-23 16:27:00 MDT` User: yes a
- `2026-06-23 16:27:31 MDT` Agent: That locks it. Here's what I now understand you want — confirm or refine: **Intent — STA score recalibration (audit phase):** - **Outcome:** A data-backed audit + recommendation t…
- `2026-06-23 16:28:35 MDT` User: yes, dispatch the subagent
- `2026-06-23 16:29:06 MDT` Agent: Dispatching the separate audit subagent now.
- `2026-06-23 16:29:32 MDT` Tool: Agent {"subagent_type":"general-purpose","description":"Audit STA score vs realized direction","run_in_background":true,"prom…
- `2026-06-23 16:29:47 MDT` Agent: Audit subagent dispatched (it'll locate the data, run the component-vs-direction analysis, and report a proposed reweighting with measured lift — no code changes until you sign of…
- `2026-06-23 16:29:50 MDT` Tool: Bash cd /home/runner/workspace node -e ' const fs=require("fs"); const j=JSON.parse(fs.readFileSync("/tmp/claude-1000/-home-runner-workspace/448268a3-eaff-42d9-a3ef…

## High-Signal Changed Files

- `.gitignore`
- `.replit`
- `AGENTS.md`
- `CLAUDE.md`
- `SESSION_HANDOFF_2026-06-22_6cfc8e90-7fbe-431c-bf8f-bf1d4453554d.md`
- `SESSION_HANDOFF_CURRENT.md`
- `SESSION_HANDOFF_MASTER.md`
- `artifacts/api-server/package.json`
- `artifacts/api-server/src/services/_kpi-verify.ts`
- `artifacts/api-server/src/services/_score_audit.ts`
- `artifacts/api-server/src/services/account-page-streams.test.ts`
- `artifacts/api-server/src/services/account-page-streams.ts`
- `artifacts/api-server/src/services/account-position-market-data-demand.test.ts`
- `artifacts/api-server/src/services/account-position-open-date.test.ts`
- `artifacts/api-server/src/services/account-position-option-quotes.test.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/automation.test.ts`
- `artifacts/api-server/src/services/automation.ts`
- `artifacts/api-server/src/services/background-worker-pressure.test.ts`
- `artifacts/api-server/src/services/bridge-option-quote-stream.test.ts`
- `artifacts/api-server/src/services/bridge-option-quote-stream.ts`
- `artifacts/api-server/src/services/bridge-streams.test.ts`
- `artifacts/api-server/src/services/bridge-streams.ts`
- `artifacts/api-server/src/services/diagnostics.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.test.ts`
- `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
- `artifacts/api-server/src/services/market-data-store.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/resource-pressure.test.ts`
- `artifacts/api-server/src/services/resource-pressure.ts`

## Repo State Snapshot

```text
## main...origin/main
 M .gitignore
 M .replit
 M AGENTS.md
 M CLAUDE.md
 M SESSION_HANDOFF_2026-06-22_6cfc8e90-7fbe-431c-bf8f-bf1d4453554d.md
 M SESSION_HANDOFF_CURRENT.md
 M SESSION_HANDOFF_MASTER.md
 M artifacts/api-server/package.json
 D artifacts/api-server/src/services/_kpi-verify.ts
 D artifacts/api-server/src/services/_score_audit.ts
 M artifacts/api-server/src/services/account-page-streams.test.ts
 M artifacts/api-server/src/services/account-page-streams.ts
 M artifacts/api-server/src/services/account-position-market-data-demand.test.ts
 M artifacts/api-server/src/services/account-position-open-date.test.ts
 M artifacts/api-server/src/services/account-position-option-quotes.test.ts
 M artifacts/api-server/src/services/account.ts
 M artifacts/api-server/src/services/automation.test.ts
 M artifacts/api-server/src/services/automation.ts
 M artifacts/api-server/src/services/background-worker-pressure.test.ts
 M artifacts/api-server/src/services/bridge-option-quote-stream.test.ts
 M artifacts/api-server/src/services/bridge-option-quote-stream.ts
 M artifacts/api-server/src/services/bridge-streams.test.ts
 M artifacts/api-server/src/services/bridge-streams.ts
 M artifacts/api-server/src/services/diagnostics.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.test.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.ts
 M artifacts/api-server/src/services/market-data-store.ts
 M artifacts/api-server/src/services/platform.ts
 M artifacts/api-server/src/services/resource-pressure.test.ts
 M artifacts/api-server/src/services/resource-pressure.ts
 M artifacts/api-server/src/services/shadow-account.ts
 M artifacts/api-server/src/services/signal-monitor-actionability.test.ts
 M artifacts/api-server/src/services/signal-monitor-actionability.ts
 M artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts
 M artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts
 M artifacts/api-server/src/services/signal-monitor-stream.test.ts
 M artifacts/api-server/src/services/signal-monitor.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/api-server/src/services/signal-options-mtf-alignment.test.ts
 M artifacts/api-server/src/services/signal-options-worker-state.ts
 M artifacts/api-server/src/services/signal-options-worker.ts
 M artifacts/pyrus/src/app/AppContent.preloadContention.test.mjs
 M artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx
 M artifacts/pyrus/src/components/platform/signal-language/SignalDots.test.mjs
 M artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx
 M artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.jsx
 M artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx
 M artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.test.mjs
 M artifacts/pyrus/src/features/platform/PlatformApp.jsx
 M artifacts/pyrus/src/features/platform/PlatformShell.jsx
 M artifacts/pyrus/src/features/platform/PlatformWatchlist.test.mjs
 M artifacts/pyrus/src/features/platform/algoEventToasts.js
 M artifacts/pyrus/src/features/platform/ibkrConnectionCredentialActionModel.js
 M artifacts/pyrus/src/features/platform/live-streams.test.mjs
 M artifacts/pyrus/src/features/platform/live-streams.ts
 M artifacts/pyrus/src/features/signals/signalMatrixSnapshotCache.js
 M artifacts/pyrus/src/features/signals/signalMatrixSnapshotCache.test.mjs
 M artifacts/pyrus/src/features/signals/signalMatrixStateMerge.js
 M artifacts/pyrus/src/features/signals/signalMatrixStateMerge.test.mjs
 M artifacts/pyrus/src/features/signals/signalSparklineModel.js
 M artifacts/pyrus/src/features/signals/signalStateFreshness.js
 M artifacts/pyrus/src/features/signals/signalsRowModel.js
 M artifacts/pyrus/src/features/signals/signalsRowModel.test.mjs
 M artifacts/pyrus/src/screens/AccountScreen.jsx
 M artifacts/pyrus/src/screens/AccountScreen.positions.test.mjs
 M artifacts/pyrus/src/screens/AlgoScreen.jsx
 M artifacts/pyrus/src/screens/AlgoScreen.test.mjs
 M artifacts/pyrus/src/screens/SignalsScreen.jsx
 M artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx
 M artifacts/pyrus/src/screens/algo/AlgoLivePage.test.mjs
 M artifacts/pyrus/src/screens/algo/AlgoSettingsRegion.jsx
 M artifacts/pyrus/src/screens/algo/AlgoTimeframeControlBand.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalTable.test.mjs
 M artifacts/pyrus/src/screens/algo/algoHelpers.js
 M artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs
 M artifacts/pyrus/src/screens/algo/algoSettingsFields.js
 M artifacts/pyrus/src/screens/algo/algoTimeframeControls.js
 M artifacts/pyrus/src/screens/algo/algoTimeframeControls.test.mjs
 M artifacts/pyrus/src/screens/algo/saveAllAlgoAdjustments.js
 M lib/api-client-react/src/custom-fetch.test.mjs
 M lib/api-client-react/src/custom-fetch.ts
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/api-zod/src/generated/types/positionOpenedAtSource.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolStatus.ts
 M lib/backtest-core/src/signal-options.ts
 M lib/db/package.json
 M lib/db/src/index.ts
 M lib/db/src/schema/automation.ts
 M lib/ibkr-contracts/src/client.ts
 M lib/pyrus-signals-core/src/index.test.ts
 M lib/pyrus-signals-core/src/index.ts
 M pnpm-lock.yaml
 M python/ibkr_sidecar/src/pyrus_ibkr_sidecar/ib_async_adapter.py
 M python/ibkr_sidecar/src/pyrus_ibkr_sidecar/registry.py
 M python/ibkr_sidecar/tests/test_registry.py
 M replit.md
 D reports/pattern-discovery-sweeps/2026-06-23T00-18-14-338Z/report.md
 D reports/pattern-discovery-sweeps/2026-06-23T00-18-14-338Z/results.json
 D reports/pattern-discovery-sweeps/2026-06-23T00-29-07-281Z/report.md
 D reports/pattern-discovery-sweeps/2026-06-23T00-29-07-281Z/results.json
 D reports/pattern-discovery-sweeps/2026-06-23T00-36-09-350Z/report.md
 D reports/pattern-discovery-sweeps/2026-06-23T00-36-09-350Z/results.json
 D reports/pattern-discovery-sweeps/2026-06-23T00-44-19-102Z/report.md
 D reports/pattern-discovery-sweeps/2026-06-23T00-44-19-102Z/results.json
 D reports/pattern-discovery-sweeps/2026-06-23T00-50-00-946Z/report.md
 D reports/pattern-discovery-sweeps/2026-06-23T00-50-00-946Z/results.json
?? SESSION_HANDOFF_2026-06-22_05de08b9-412a-433f-a1e1-33040f5a9a33.md
?? SESSION_HANDOFF_2026-06-22_b32152c8-6f81-42fe-b9d5-dbdf7a39c334.md
?? SESSION_HANDOFF_2026-06-22_d187047c-6b3e-49a9-90dc-523ec2d9d062.md
?? SESSION_HANDOFF_2026-06-22_ea53db29-10af-439e-8202-689f9a32d702.md
?? SESSION_HANDOFF_2026-06-23_003c963e-84d5-4d54-a635-b1be93d07af8.md
?? SESSION_HANDOFF_2026-06-23_019ef4df-4e03-7853-8188-58678a0c002e.md
?? SESSION_HANDOFF_2026-06-23_019ef4e0-e9ef-7530-9683-02fdedd1353e.md
?? SESSION_HANDOFF_2026-06-23_019ef54a-f039-7bd1-a68c-b751588f8a44.md
?? SESSION_HANDOFF_2026-06-23_019ef553-003d-7813-92e3-1cab63e7c332.md
?? SESSION_HANDOFF_2026-06-23_019ef553-1800-7793-a171-35e10a577ee6.md
?? SESSION_HANDOFF_2026-06-23_019ef553-323d-70e1-a1f4-f26c35878376.md
?? SESSION_HANDOFF_2026-06-23_019ef558-015f-79d2-9f29-541e026a8d57.md
?? SESSION_HANDOFF_2026-06-23_019ef579-7253-7ad1-a8ce-ebfd073ee513.md
?? SESSION_HANDOFF_2026-06-23_019ef57d-9248-7872-bbc2-cbdaa64d23ef.md
?? SESSION_HANDOFF_2026-06-23_019ef585-076c-7241-90d2-c1119be71962.md
?? SESSION_HANDOFF_2026-06-23_019ef58d-7a62-7ec3-afa0-9be04480c0e0.md
?? SESSION_HANDOFF_2026-06-23_019ef59c-0a1b-72d1-8ab2-dea7286aa787.md
?? SESSION_HANDOFF_2026-06-23_019ef5b5-9037-7ee0-86e0-1a5d232d704c.md
?? SESSION_HANDOFF_2026-06-23_019ef5b5-91df-7d32-8a1b-a6c0ac3a07c9.md
?? SESSION_HANDOFF_2026-06-23_019ef5b5-9ab2-7b71-a8fa-aa72e5e6bd72.md
?? SESSION_HANDOFF_2026-06-23_019ef5bf-be20-7bd1-872e-669db64fa525.md
?? SESSION_HANDOFF_2026-06-23_019ef5cb-2c48-7ac2-a442-80c8289be0b0.md
?? SESSION_HANDOFF_2026-06-23_019ef5cd-598f-7423-ae59-359c11bd3155.md
?? SESSION_HANDOFF_2026-06-23_019ef5e1-d28b-7580-9105-9a219848cc6f.md
?? SESSION_HANDOFF_2026-06-23_2d4a08d7-3605-48cc-be52-c0af8e69e01c.md
?? SESSION_HANDOFF_2026-06-23_43e47bfc-4de9-4f06-a0ca-86d20fca55e2.md
?? SESSION_HANDOFF_2026-06-23_448268a3-eaff-42d9-a3ef-e2bb10e67b33.md
?? SESSION_HANDOFF_2026-06-23_93084a11-33e5-4b19-b7b2-4e8c272608ec.md
?? SESSION_HANDOFF_2026-06-23_a2f03216-01b2-475c-a198-ff3158b5fadd.md
?? SESSION_HANDOFF_2026-06-23_a5137a42-097a-48cf-864c-cd9ac65b4cab.md
?? SESSION_HANDOFF_2026-06-23_b2737a45-9d93-4f58-bcf4-a4bd57d37ad7.md
?? SESSION_HANDOFF_2026-06-23_b7565900-4439-49ff-a140-77a89f5b2618.md
?? SESSION_HANDOFF_LIVE_2026-06-23_bar-cache-freeze-fix.md
?? artifacts/api-server/src/services/algo-deployment-profile-shape.ts
?? artifacts/api-server/src/services/market-data-store-batch-equality.test.ts
?? artifacts/api-server/src/services/market-data-store-pglite.test.ts
?? artifacts/api-server/src/services/options-flow-scanner-pressure.test.ts
?? artifacts/api-server/src/services/shadow-account-recompute.test.ts
?? artifacts/api-server/src/services/signal-monitor-local-bar-cache-prefetch.test.ts
?? artifacts/api-server/src/services/signal-monitor-stale-rescue.test.ts
?? artifacts/pyrus/src/features/platform/MarketDataSubscriptionProvider.test.mjs
?? artifacts/pyrus/src/features/platform/algoEventToasts.test.mjs
?? artifacts/pyrus/src/features/platform/criticalApiMutationPause.js
?? artifacts/pyrus/src/features/signals/signalStateFreshness.test.mjs
?? artifacts/pyrus/src/screens/algo/saveAllAlgoAdjustments.test.mjs
?? docs/plans/errant-resource-pressure-remediation-2026-06-23.md
?? lib/db/migrations/20260623_execution_events_overnight_partial_idx.sql
?? lib/db/src/testing.ts
```

## Diff Summary

```text
 .gitignore     |      1 +
 .replit        |     24 +-
 AGENTS.md      |      4 +-
 CLAUDE.md      |     39 +-
 ...4453554d.md |    100 +-
 ..._CURRENT.md |     35 +-
 ...F_MASTER.md |     34 +-
 ...ackage.json |      5 +-
 ...i-verify.ts |     32 -
 ...re_audit.ts |    139 -
 ...ams.test.ts |     14 +
 ...-streams.ts |     10 +-
 ...and.test.ts |     42 +
 ...ate.test.ts |     95 +
 ...tes.test.ts |      9 +-
 .../account.ts |    358 +-
 ...ion.test.ts |     72 +
 ...tomation.ts |    277 +-
 ...ure.test.ts |    114 +-
 ...eam.test.ts |     78 +
 ...e-stream.ts |     17 +-
 ...ams.test.ts |     42 +
 ...-streams.ts |     99 +-
 ...gnostics.ts |     33 +-
 ...ime.test.ts |     61 +-
 ...-runtime.ts |      1 +
 ...ta-store.ts |    140 +
 ...platform.ts |     24 +-
 ...ure.test.ts |     76 +-
 ...pressure.ts |     34 +-
 ...-account.ts |     58 +-
 ...ity.test.ts |      8 +
 ...nability.ts |      4 +-
 ...ars.test.ts |    301 +-
 ...ar-cache.ts |    107 +-
 ...eam.test.ts |     71 +
 ...-monitor.ts |    592 +-
 ...tomation.ts |     79 +-
 ...ent.test.ts |     80 +-
 ...er-state.ts |      3 +
 ...s-worker.ts |    738 +-
 ...on.test.mjs |     15 +-
 ...nalDots.jsx |     33 +-
 ...ts.test.mjs |     60 +-
 ...erStack.jsx |      7 +-
 ...rovider.jsx |    158 +-
 ...Sidebar.jsx |      6 +
 ...ar.test.mjs |     10 +
 ...formApp.jsx |    126 +-
 ...rmShell.jsx |      3 +
 ...st.test.mjs |     74 +-
 ...ntToasts.js |     36 +
 ...ionModel.js |     31 +-
 ...ms.test.mjs |    114 +
 ...-streams.ts |     18 +-
 ...hotCache.js |      2 +
 ...he.test.mjs |      8 +
 ...ateMerge.js |      2 +
 ...ge.test.mjs |     23 +
 ...ineModel.js |      1 +
 ...reshness.js |     22 +-
 ...RowModel.js |     67 +-
 ...el.test.mjs |     34 +
 ...tScreen.jsx |      4 +-
 ...ns.test.mjs |     13 +
 ...oScreen.jsx |    115 +-
 ...en.test.mjs |     91 +
 ...sScreen.jsx |     37 +-
 ...ivePage.jsx |     31 +-
 ...ge.test.mjs |     38 +
 ...sRegion.jsx |     12 +-
 ...rolBand.jsx |      2 +
 ...gnalRow.jsx |     12 +-
 ...alTable.jsx |     67 +-
 ...le.test.mjs |    284 +-
 ...oHelpers.js |     64 +-
 ...rs.test.mjs |    111 +-
 ...gsFields.js |     10 +-
 ...Controls.js |     58 +-
 ...ls.test.mjs |     50 +-
 ...ustments.js |      7 +-
 ...ch.test.mjs |     18 +
 ...om-fetch.ts |     14 +-
 ....schemas.ts |      2 +
 ...penapi.yaml |      2 +-
 .../api.ts     |     10 +-
 ...AtSource.ts |      1 +
 ...olStatus.ts |      1 +
 ...-options.ts |      9 +-
 ...ackage.json |      2 +
 .../index.ts   |     59 +-
 ...tomation.ts |      3 +
 .../client.ts  |      1 +
 ...dex.test.ts |     54 +
 .../index.ts   |     12 +-
 pnpm-lock.yaml |     28 +-
 ..._adapter.py |     10 +-
 ...registry.py |     34 +-
 ...registry.py |     56 +
 replit.md      |      2 +-
 .../report.md  |    288 -
 ...esults.json |   2597 -
 .../report.md  |   1547 -
 ...esults.json |  16765 -
 .../report.md  |   2891 -
 ...esults.json |  31605 --
 .../report.md  |   6253 -
 ...esults.json |  68633 ----
 .../report.md  |   9613 -
 ...esults.json | 105841 ------
 110 files changed, 5302 insertions(+), 246955 deletions(-)
```

## Validations Detected In Transcript

- `2026-06-23 14:00:35 MDT` cd /home/runner/workspace/artifacts/pyrus echo "=== typecheck ==="; pnpm run typecheck 2>&1 | tail -4 echo "=== tests that might touch these surfaces ===" ls s… (ok)
- `2026-06-23 14:10:09 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck ==="; pnpm run typecheck 2>&1 | tail -6 echo "=== resource-pressure + diagnostics db-pressur… (ok)
- `2026-06-23 14:36:31 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== scanner-pressure test + resource-pressure (A3/A4) ===" node --import tsx --test src/services/options-f… (ok)
- `2026-06-23 14:38:24 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck (A5 removed a caller — check no orphan import) ===" pnpm run typecheck 2>&1 | tail -5 echo "… (ok)
- `2026-06-23 15:15:48 MDT` cd /home/runner/workspace echo "=== rebuild lib/db decls (composite) + confirm __setDbForTests export ===" rg -n '__setDbForTests' lib/db/src/index.ts | head n… (ok)
- `2026-06-23 15:20:09 MDT` cd /home/runner/workspace echo "=== rebuild lib/db decls (testing export) + api-server typecheck ===" npx tsc --build lib/db 2>&1 | tail -2 cd artifacts/api-se… (ok)
- `2026-06-23 15:27:23 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck ===" pnpm run typecheck 2>&1 | tail -4 echo "=== prefetch behavior-equality + the existing b… (ok)
- `2026-06-23 15:29:54 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck (signal-monitor wiring) ===" pnpm run typecheck 2>&1 | tail -5 echo "=== prefetch behavior-e… (ok)
- `2026-06-23 15:33:31 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck (both boundaries wired) ===" pnpm run typecheck 2>&1 | tail -4 echo "=== regression: bar-cac… (ok)
- `2026-06-23 15:47:55 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck after heap-fallback fix ===" pnpm run typecheck 2>&1 | tail -4 echo "=== regression: pressur… (ok)
- `2026-06-23 15:56:14 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck (B3 selectDistinct + SQL sum) ===" pnpm run typecheck 2>&1 | tail -5 echo "=== existing shad… (ok)
- `2026-06-23 15:58:46 MDT` cd /home/runner/workspace/artifacts/api-server echo "=== typecheck ===" pnpm run typecheck 2>&1 | tail -4 echo "=== B3 property test (set-based recompute == JS… (ok)

## What Changed This Session

> NOTE: This session = resource-pressure remediation + a PGlite DB test harness + two
> subagent fixes + a scoring audit. The stale algo-deployment notes that previously sat
> here were from a DIFFERENT (prior) session and have been replaced. ALL of this is
> UNCOMMITTED. Plan doc: `docs/plans/errant-resource-pressure-remediation-2026-06-23.md`.

**Resource-pressure remediation (the errant-pressure fix):**
- **A1** dbPool/heap removed from the `immediateHigh` bypass → 2-sample hysteresis (RSS stays the only instant hard-block). `resource-pressure.ts` (buildSnapshot ~390; tests updated).
- **A2** heap pressure gated on container-relative % (not the ~2.7GB V8 ceiling), with a **V8-ceiling fallback when cgroup `memory.max` is unreadable** (the perfection-review "heap-fix"). `diagnostics.ts` (~2672-2734) + `getContainerMemoryLimitMb()` export in `resource-pressure.ts`.
- **A3** event-loop thresholds 60/250 → **150/400 ms**. `resource-pressure.ts`.
- **A4** api-latency dropped from the options-flow scanner gate; hydration suppression `watch`→`high`. `platform.ts` (~1216, ~17316).
- **A5** client-metrics POST no longer re-runs pressure on stale inputs. `diagnostics.ts` (recordClientDiagnosticsMetrics).
- **B1** batched bar-fallback prefetch: `loadStoredMarketBarsForSymbols` (`market-data-store.ts`) + `runWithSignalMonitorStoredBarsPrefetch` (AsyncLocalStorage, `signal-monitor-local-bar-cache.ts`) wired at BOTH the matrix-eval boundary (`signal-monitor.ts` ~10146, limit 240) AND the monitor-refresh boundary (`evaluateSymbolsInBatches` ~8901, limit `PYRUS_SIGNALS_SIGNAL_WARMUP_BARS`). Per-symbol path is the fallback.
- **B3** set-based shadow-account recompute (`selectDistinct` order ids + SQL `SUM`, analytics filter stays in JS) replacing the unbounded full-ledger scan inside the write tx. `shadow-account.ts` (`recomputeShadowAccountFromLedger`, now exported for tests).
- **B2** bar_cache persist flush batched: `persistMarketDataBarsForSymbols` (`market-data-store.ts`) + flush regrouped by (timeframe,source) → one multi-symbol upsert/group; requeues on false-return too. `signal-monitor-local-bar-cache.ts` (override seam renamed to `__setPersistMarketDataBarsForSymbolsForTests`).

**PGlite DB test harness:** `lib/db/src/index.ts` (forwarding-Proxy seam + `__setDbForTests`), `lib/db/src/testing.ts` (`createTestDb`/`withTestDb`, full schema into PGlite), `lib/db/package.json` + `artifacts/api-server/package.json` (`@electric-sql/pglite` dep). Prod-safe (inert unless `__setDbForTests`).

**Errant-stale-signals fix (subagent):** after-hours/Massive false-staleness — a lane stays fresh if the live Massive ring has a current bar; truly-empty rings stay legitimately idle. `signal-monitor.ts` (`signalMonitorStreamLaneLatestCompletedBarAt` + `isSignalMonitorStateCurrentForLane`). New `signal-monitor-stale-rescue.test.ts` (6).

**STA-score direction audit (subagent, AUDIT-ONLY — no code changed):** `docs/audits/sta-score-direction-audit-2026-06-23.md`. Verdict: the score's varying inputs (MTF alignment + ADX) are ~random at predicting direction (AUC ~0.51, IV<0.02); a fitted reweight did NOT beat current on held-out data. Real lever = a NEW direction/drift prior captured into `signal_monitor_events.payload.filterState`, then re-audit. Score: `signal-options-automation.ts:4481-4575` (frontend `algoHelpers.js:1642`).

**Run-rule docs:** `CLAUDE.md` / `AGENTS.md` / `replit.md` updated to authorize agent-driven restart via `REPLIT_MODE=workflow` (+ the pid2 "no auto-restart on a clean SIGTERM" gotcha).

## Current Status

- **EVERYTHING IS UNCOMMITTED.** Branch `main` (ahead of origin by 1). ~22+ files changed/new this session, NOTHING committed. The working tree also still carries PRIOR dropped-session work (pyrus algo screens, signalsRowModel, etc.) — be selective when committing.
- **DEPLOYED LIVE before the reset:** A1-A5, B1, B3 (verified in the running build; resourceLevel normal).
- **DONE but NOT deployed (source-only):** B2, the A2 heap-fix, the errant-stale-signals fix.
- **Tests:** api-server `typecheck` CLEAN. Green suites: `resource-pressure`, `diagnostics-db-pressure`, `options-flow-scanner-pressure`, `background-worker-pressure`, `market-data-store-persist-equality` (3), `market-data-store-batch-equality` (3), `market-data-store-pglite` (2), `signal-monitor-local-bar-cache(-prefetch/-rollup/-persist)`, `shadow-account-recompute` (3), `signal-monitor-stale-rescue` (6), `gex-chart-snapshot-cache`.
- **VERIFICATION GOTCHA:** running MULTIPLE PGlite-harness suites in ONE `node --test` process **Bus-errors** (WASM memory). Run harness suites in SEPARATE processes.
- **Pressure hunt verdict:** machinery healthy; residual pool load = un-gated `bar_cache` writes (B2 addresses) + a startup prewarm burst (rank 2, NOT done). Earlier "pool relieved" was a momentary point-sample; bursts still saturate at 12/12 — B2 cuts the write round-trips.
- **Shell note:** bare `node`/`pnpm` PATH went flaky late-session; use `/nix/store/9cyx2v23dip6p9q98384k9v06c96qskb-nodejs-24.13.0/bin/node` if `node` is not found.

## Next Recommended Steps

1. **After reset:** confirm the working tree survived (`git status --short` → the ~22 files; spot-check `resource-pressure.ts`, `market-data-store.ts`, `signal-monitor-local-bar-cache.ts`, `shadow-account.ts`, `lib/db/src/testing.ts`). Replit's persistent fs should retain uncommitted changes; this handoff is the recovery list if not.
2. **Deploy (open decision):** rebuild + restart via `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit` (background) to bring **B2 + heap-fix + stale-signals fix** live (A1-A5/B1/B3 already live). The pid2 cascade (supervisor exit 143) is expected but ends clean on ports 8080 + 18747 (→ external 3000 preview). Do NOT kill-and-wait — pid2 won't auto-restart a clean SIGTERM.
3. **Commit (open decision):** nothing committed. Suggested logical groups: pressure-A; PGlite harness; B1; B3; B2; stale-signals; docs (plan + audit + run-rules). Separate from the pre-existing dirty prior-session work.
4. **Scoring fork (STA audit):** decide (a) add a direction/drift prior (new feature → capture into `filterState` at emit, then re-audit) or (b) reframe the score honestly as setup-quality. See the audit report.
5. **Optional pressure hardening:** rank 2 startup-prewarm ramp (pressure hunt). B4/B5/B6 deferred (low value now that the pool is relieved by A+B1+B2).

## Latest Update - 2026-06-23 16:54:52 MDT

- Checked rebuilt runtime: no app was listening on `18747` or `8080`, and no Vite/API/pnpm runner was present. The official artifact command still points to `pnpm --filter @workspace/pyrus run dev:replit`, but `corepack pnpm` attempted dependency maintenance, so it was aborted before changes and API+Vite were started directly with the same child commands for validation only.
- API deployments endpoint returned both deployment rows: Signal Options `7e2e4e6f-749f-4e65-a011-87d3559a23b0` and Overnight Equities `ba722928-631c-4750-8e8c-2f3c5b91ed23`.
- Reproduced the save-adjacent DB bottleneck in API logs: `execution_events` reads for `deployment_id = 7e2e4e6f... AND event_type LIKE $2 ORDER BY occurred_at DESC LIMIT 2500` were timing out because the bound `LIKE` predicate did not prove the existing partial index.
- Code fix: `listDeploymentEvents` now uses the literal predicate `event_type LIKE 'signal_options_%'` so Postgres can use `execution_events_sigopt_deploy_occurred_idx`.
- DB/schema fix: added `execution_events_deployment_occurred_idx` for deployment-only event readers and migration `lib/db/migrations/20260623_execution_events_deployment_occurred_idx.sql`.
- Live DB action: created `execution_events_deployment_occurred_idx` concurrently with statement timeout disabled; completed in `24668ms`.
- Live DB verification: `EXPLAIN (ANALYZE)` for the Signal Options 2500-row event window used `execution_events_sigopt_deploy_occurred_idx`, execution time `28.054ms`.
- Runtime save verification after API restart: direct API PATCH changed `minBid` 0.02 -> 0.03 in `578ms`, then restored 0.02 in `399ms`.
- Validation passed: `artifacts/api-server/node_modules/.bin/tsx --test artifacts/api-server/src/services/signal-options-event-window.test.ts`; `node node_modules/typescript/bin/tsc -p artifacts/api-server/tsconfig.json --noEmit`.
- Browser QA blocker: Playwright Chromium cannot launch in this shell because `libglib-2.0.so.0` is missing and no system Chromium is on `PATH`. The test restore ran, so `minBid` is back to 0.02.
- Remaining next bottleneck: after fixing/restarting the event-log path, API boot logs still show a separate `signal_monitor_events` reconciliation query timing out. That is now the next likely DB pressure source, separate from the Algo control-panel save endpoint.

## Handoff Prepared - 2026-06-23 16:57:42 MDT

- Manual validation servers started during this session were stopped before handoff. Verified `http://127.0.0.1:18747/` and `http://127.0.0.1:8080/api/session` now refuse connections, and process scan shows no Vite/API runner.
- Relevant files from this turn:
  - `artifacts/api-server/src/services/signal-options-automation.ts`: event-window query predicate changed to literal `event_type LIKE 'signal_options_%'`.
  - `artifacts/api-server/src/services/signal-options-event-window.test.ts`: source guard updated to prevent returning to bound `LIKE`.
  - `lib/db/src/schema/automation.ts`: added generic `execution_events_deployment_occurred_idx` schema index.
  - `lib/db/migrations/20260623_execution_events_deployment_occurred_idx.sql`: new migration for the generic deployment event index.
  - Handoff files: `SESSION_HANDOFF_CURRENT.md`, `SESSION_HANDOFF_MASTER.md`, and this durable handoff.
- Important shared-worktree note: `signal-options-automation.ts` already contains substantial unrelated edits from earlier work in the same session/worktree. Do not assume the whole file diff belongs to the event-log fix.
- Resume next with normal Replit Run App startup, not the manual child commands used here for validation. Then investigate the `signal_monitor_events` reconciliation timeout and browser-verify Algo save in an environment with working Chromium/Replit preview.
