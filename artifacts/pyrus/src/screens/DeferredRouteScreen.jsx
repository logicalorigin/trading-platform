import { useEffect, useState } from "react";
import { NeuralLoader } from "../components/neural/NeuralLoader";
import { retryDynamicImport } from "../lib/dynamicImport";

export const createDeferredRouteScreen = ({
  loadModule,
  moduleLabel,
  loadingText,
  loadingTestId,
}) => {
  let moduleImport = null;
  let loadedImplementation = null;
  const loadImplementation = () => {
    if (!moduleImport) {
      moduleImport = retryDynamicImport(loadModule, {
        label: moduleLabel,
      })
        .then((mod) => {
          if (!mod?.default) {
            throw new Error(`${moduleLabel} resolved without a default component.`);
          }
          return mod;
        })
        .catch((error) => {
          moduleImport = null;
          throw error;
        });
    }
    return moduleImport;
  };

  const LoadingStatus = () => (
    <NeuralLoader
      label={loadingText}
      minHeight={160}
      variant="workspace"
      testId={loadingTestId}
      tone="panel"
    />
  );

  const DeferredRouteScreen = (props) => {
    const [Implementation, setImplementation] = useState(
      () => loadedImplementation,
    );
    const [loadError, setLoadError] = useState(null);
    const implementationVisible =
      props.isHostVisible ?? props.isVisible;

    useEffect(() => {
      if (Implementation || implementationVisible === false) {
        return undefined;
      }
      let cancelled = false;
      let frameId = null;
      let timeoutId = null;
      const scheduleLoad = () => {
        timeoutId = window.setTimeout(() => {
          if (cancelled) {
            return;
          }
          loadImplementation().then(
            (mod) => {
              if (!cancelled) {
                try {
                  const nestedPreload = mod.preloadScreenModules?.();
                  void nestedPreload?.catch?.(() => undefined);
                } catch {
                  // Nested preloads are opportunistic; lazy boundaries still retry.
                }
                loadedImplementation = mod.default;
                props.onReadinessChange?.({
                  frameReady: true,
                  contentReady: false,
                  primaryReady: false,
                  derivedReady: false,
                  backgroundAllowed: false,
                  error: null,
                });
                setImplementation(() => mod.default);
              }
            },
            (error) => {
              if (!cancelled) {
                const normalizedError =
                  error instanceof Error ? error : new Error(String(error));
                props.onReadinessChange?.({
                  frameReady: true,
                  contentReady: true,
                  primaryReady: false,
                  derivedReady: false,
                  backgroundAllowed: false,
                  error: normalizedError,
                });
                setLoadError(normalizedError);
              }
            },
          );
        }, 0);
      };

      // React may flush effects caused by a discrete click before the browser
      // paints. Cross a rendering opportunity before evaluating the heavy route.
      if (document.visibilityState === "hidden") {
        scheduleLoad();
      } else {
        frameId = window.requestAnimationFrame(scheduleLoad);
      }

      return () => {
        cancelled = true;
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      };
    }, [Implementation, implementationVisible]);

    if (loadError) {
      throw loadError;
    }
    if (!Implementation) {
      return <LoadingStatus />;
    }
    return <Implementation {...props} />;
  };

  DeferredRouteScreen.displayName = `${moduleLabel}Route`;
  return DeferredRouteScreen;
};
