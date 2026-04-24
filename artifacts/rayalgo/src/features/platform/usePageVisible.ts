import { useEffect, useState } from "react";

const readPageVisible = (): boolean => {
  if (typeof document === "undefined") {
    return true;
  }

  return document.visibilityState !== "hidden";
};

export const usePageVisible = (): boolean => {
  const [pageVisible, setPageVisible] = useState(readPageVisible);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      setPageVisible(readPageVisible());
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return pageVisible;
};
