export const getIbkrPlatformErrorCode = (error) =>
  typeof error?.code === "string" ? error.code : null;

export const isIbkrLoginKeyReadActivationNotFoundError = (error) =>
  getIbkrPlatformErrorCode(error) === "ibkr_bridge_activation_not_found";

export const isTransientIbkrLoginKeyReadError = (error) => {
  if (Number.isFinite(error?.status)) {
    return false;
  }

  return getIbkrPlatformErrorCode(error) == null;
};
