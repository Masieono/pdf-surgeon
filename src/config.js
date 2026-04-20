export const MANIFEST_VERSION = 1;
export const LS_MANIFEST_KEY = "pdfsurgery_manifest_v1";
export const LS_THEME_PREF_KEY = "pdfsurgery_theme_pref_v1";
export const AUTOSAVE_DEBOUNCE_MS = 350;

export const DEFAULT_THUMB_SCALE = 0.2;
export const DEFAULT_PREVIEW_SCALE = 1.5;
export const DEFAULT_EXPORT_FILE_NAME = "output.pdf";
export const DEFAULT_OUTPUT_FIND_MODE = "output_position";
export const DEFAULT_IMAGE_IMPORT_MODE = "separate";
export const DEFAULT_IMAGE_IMPORT_ORDER = "as_selected";
export const DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES = false;
export const DEFAULT_IMAGE_IMPORT_AUTO_APPEND = false;
export const SOFT_WARN_IMPORT_SIZE_MB = 80;
export const SOFT_WARN_IMPORT_PAGE_COUNT = 600;
export const SOFT_WARN_OUTPUT_PAGE_COUNT = 1200;
export const THUMB_CACHE_MAX_ITEMS = 48;
export const DEFAULT_WATERMARK = {
  enabled: false,
  mode: "text",
  text: "",
  target: "all_output_pages",
  rangeInput: "",
  position: "diagonal_center",
  opacity: 0.18,
  rotationDeg: 45,
  sizeMode: "max_fit",
  fontSizePct: 8,
  imageDataUrl: "",
  imageName: "",
  imageFit: "contain",
};
export const DEFAULT_HEADER_FOOTER = {
  enabled: false,
  headerText: "",
  footerText: "",
  headerPosition: "top_left",
  footerPosition: "bottom_left",
  pageNumbersEnabled: false,
  pageNumberFormat: "Page {page} of {total}",
  pageNumberPosition: "bottom_center",
  target: "all_output_pages",
  rangeInput: "",
  opacity: 0.9,
  fontSizePt: 10,
  marginPt: 24,
};

export function createInitialState() {
  return {
    manifestVersion: MANIFEST_VERSION,
    files: [],
    docPlan: [],
    history: {
      past: [],
      future: [],
    },
    ui: {
      activeView: "sources",
      selectedFileId: null,
      selectedSourcePageIndex: 0,
      selectedSourcePageIndices: [],
      lastSelectedSourcePageIndex: null,
      selectedOutputPageIndices: [],
      lastSelectedOutputIndex: null,
      outputCursorIndex: 0,
      thumbScale: DEFAULT_THUMB_SCALE,
      previewScale: DEFAULT_PREVIEW_SCALE,
      textQuery: "",
      textMatchQuery: "",
      textMatchCounts: {},
      textMatchOccurrences: {},
      textSearchDetectedFiles: {},
      exportFileName: DEFAULT_EXPORT_FILE_NAME,
      outputFindMode: DEFAULT_OUTPUT_FIND_MODE,
      imageImportDefaults: {
        mode: DEFAULT_IMAGE_IMPORT_MODE,
        order: DEFAULT_IMAGE_IMPORT_ORDER,
        skipDuplicates: DEFAULT_IMAGE_IMPORT_SKIP_DUPLICATES,
        autoAppendToOutput: DEFAULT_IMAGE_IMPORT_AUTO_APPEND,
      },
      watermark: { ...DEFAULT_WATERMARK },
      headerFooter: { ...DEFAULT_HEADER_FOOTER },
      exportMetadata: {
        title: "",
        author: "",
        subject: "",
        keywords: "",
      },
    },
    runtime: {
      busy: false,
      lastError: null,
      job: null,
      history: {
        canUndo: false,
        canRedo: false,
        nextUndoLabel: null,
        nextRedoLabel: null,
      },
    },
  };
}
