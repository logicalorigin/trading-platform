import { execFile } from "node:child_process";

const DIGEST_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/u;
const LOCAL_IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const EXPECTED_ENTRYPOINT = "/usr/local/bin/pyrus-capsule-supervisor.py";

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function emptyRecordOrNull(value) {
  const record = asRecord(value);
  return (
    value === null ||
    value === undefined ||
    (record !== null && Object.keys(record).length === 0)
  );
}

export function execFileCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        shell: false,
        timeout: options.timeoutMs ?? 15 * 60_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          code:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stderr,
          stdout,
        });
      },
    );
  });
}

export function isImmutableCapsuleImageReference(value) {
  return (
    typeof value === "string" &&
    value.length <= 512 &&
    (DIGEST_IMAGE_PATTERN.test(value) || LOCAL_IMAGE_ID_PATTERN.test(value))
  );
}

function validateInspection(imageReference, stdout, expectedLabels) {
  let image;
  try {
    image = asRecord(JSON.parse(stdout));
  } catch {
    image = null;
  }
  const config = asRecord(image?.Config);
  const labels = asRecord(config?.Labels);
  const entrypoint = Array.isArray(config?.Entrypoint) ? config.Entrypoint : [];
  const repoDigests = Array.isArray(image?.RepoDigests)
    ? image.RepoDigests
    : [];
  const matchesReference = LOCAL_IMAGE_ID_PATTERN.test(imageReference)
    ? image?.Id === imageReference
    : repoDigests.includes(imageReference);
  const labelsMatch = Object.entries(expectedLabels).every(
    ([name, value]) =>
      typeof value === "string" && value.length > 0 && labels?.[name] === value,
  );

  if (
    !matchesReference ||
    image?.Os !== "linux" ||
    image?.Architecture !== "amd64" ||
    !LOCAL_IMAGE_ID_PATTERN.test(String(image?.Id ?? "")) ||
    config?.User !== "10001:10001" ||
    entrypoint.length !== 1 ||
    entrypoint[0] !== EXPECTED_ENTRYPOINT ||
    (config?.Healthcheck !== null && config?.Healthcheck !== undefined) ||
    !emptyRecordOrNull(config?.Volumes) ||
    !labelsMatch
  ) {
    throw new Error("The capsule image metadata is invalid.");
  }

  return image.Id;
}

export async function preloadCapsuleImage(imageReference, options = {}) {
  if (!isImmutableCapsuleImageReference(imageReference)) {
    throw new Error(
      "The capsule image reference must use an immutable sha256 digest.",
    );
  }
  const runCommand = options.runCommand ?? execFileCommand;
  const dockerBinary = options.dockerBinary ?? "docker";
  const expectedLabels = options.expectedLabels ?? {};
  const inspectArgs = [
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    imageReference,
  ];
  let inspected = await runCommand(dockerBinary, inspectArgs);
  let pulled = false;

  if (inspected.code !== 0) {
    if (LOCAL_IMAGE_ID_PATTERN.test(imageReference)) {
      throw new Error("The local capsule image is unavailable.");
    }
    const pull = await runCommand(dockerBinary, [
      "pull",
      "--platform",
      "linux/amd64",
      imageReference,
    ]);
    if (pull.code !== 0) {
      throw new Error("The exact capsule image could not be pulled.");
    }
    pulled = true;
    inspected = await runCommand(dockerBinary, inspectArgs);
    if (inspected.code !== 0) {
      throw new Error("The pulled capsule image is unavailable.");
    }
  }

  return {
    imageId: validateInspection(
      imageReference,
      inspected.stdout,
      expectedLabels,
    ),
    imageReference,
    pulled,
  };
}
