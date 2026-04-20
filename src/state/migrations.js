import { isPlainObject } from "./store-helpers.js";

export function migrateManifest(rawManifest) {
  if (rawManifest == null) {
    return null;
  }

  if (!isPlainObject(rawManifest)) {
    return null;
  }

  if (typeof rawManifest.manifestVersion !== "number") {
    return null;
  }

  // v1: no schema migration yet; normalize required top-level keys only.
  return {
    ...rawManifest,
    manifestVersion: rawManifest.manifestVersion,
    files: Array.isArray(rawManifest.files) ? rawManifest.files : [],
    docPlan: Array.isArray(rawManifest.docPlan) ? rawManifest.docPlan : [],
    history:
      isPlainObject(rawManifest.history) && Array.isArray(rawManifest.history.past)
        ? {
            past: rawManifest.history.past,
            future: Array.isArray(rawManifest.history.future) ? rawManifest.history.future : [],
          }
        : { past: [], future: [] },
    ui: isPlainObject(rawManifest.ui) ? rawManifest.ui : {},
  };
}
