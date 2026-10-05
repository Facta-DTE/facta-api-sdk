export { FactaProvider, FactaWindowError, useFactaWindow } from "./provider.tsx";
export type { FactaProviderProps } from "./provider.tsx";
export { useFactaIssue } from "./use-issue.ts";
export type {
  AutoCloseOn,
  AutoCloseState,
  FactaEvent,
  FactaEventType,
  OpenWindowOptions,
  UseFactaIssue,
  UseFactaIssueOptions,
} from "./use-issue.ts";
export {
  FactaInvoiceDialog,
  FactaInvoiceDrawer,
  FactaInvoiceInline,
  FactaInvoiceWindow,
} from "./windows.tsx";
export type {
  FactaInlineProps,
  FactaInvoiceWindowProps,
  FactaLayerProps,
  FactaWindowProps,
} from "./windows.tsx";
export { FactaIssueButton, IssueButtonView } from "./button.tsx";
export type { FactaIssueButtonProps, IssueButtonViewProps } from "./button.tsx";
export { FactaReceipt } from "./receipt.tsx";
export type { FactaReceiptProps } from "./receipt.tsx";
export { FactaStatusBadge } from "./status-badge.tsx";
export type { FactaStatusBadgeProps } from "./status-badge.tsx";
export { FactaWindowView } from "./card.tsx";
export type { CardVariant, FactaWindowViewProps } from "./card.tsx";
export { FactaRoot } from "./look.tsx";
export type { FactaBranding, FactaClassNames, FactaClassNameSlot, FactaLook, FactaSlotStyles } from "./look.tsx";
export { DeliveryRows } from "./delivery.tsx";
export type {
  DeliveryView,
  FactaAppearance,
  FactaDensity,
  FactaMotion,
  FactaSlot,
  FactaTheme,
  FactaVariables,
  FactaMessagesOverride,
  FlowFailure,
  IssueResult,
  RunMode,
} from "../browser/index.ts";

// Data components and hooks (docs/react-signing-ui.md §11).
export { FactaDocumentList, periodRange } from "./document-list.tsx";
export type { FactaDocumentListProps } from "./document-list.tsx";
export { FactaDocumentDetail } from "./document-detail.tsx";
export type { FactaDocumentDetailProps } from "./document-detail.tsx";
export { FactaDownloadButton } from "./download-button.tsx";
export type { FactaDownloadButtonProps } from "./download-button.tsx";
export { FactaCustomerPicker, FactaProductPicker } from "./pickers.tsx";
export type { FactaCustomerPickerProps, FactaProductPickerProps } from "./pickers.tsx";
export { FactaServiceStatus } from "./service-status.tsx";
export type { FactaServiceStatusProps } from "./service-status.tsx";
export { FactaStorageMeter, formatStorageBytes } from "./storage-meter.tsx";
export type { FactaStorageMeterProps } from "./storage-meter.tsx";
export { FactaInvalidateDialog } from "./invalidate-dialog.tsx";
export type { FactaInvalidateDialogProps } from "./invalidate-dialog.tsx";
export {
  copyText,
  useFactaActions,
  useFactaCustomers,
  useFactaDocument,
  useFactaDocumentCopies,
  useFactaDocuments,
  useFactaProducts,
  useFactaServiceStatus,
  useFactaStorage,
} from "./data-hooks.ts";
export type {
  CatalogSearch,
  QueryState,
  UseCatalogSearchOptions,
  UseFactaActions,

  UseFactaDocumentOptions,
  UseFactaDocuments,
  UseFactaDocumentsOptions,
  UseFactaServiceStatus,
  UseFactaStorage,
} from "./data-hooks.ts";
export type {
  CopyRow,
  CustomerOption,
  DocumentDetail,
  DocumentFilters,
  DocumentPage,
  DocumentRow,
  DownloadKind,
  InvalidationInfo,
  InvalidationOutcome,
  ProductOption,
  ServiceState,
  StorageView,
} from "../browser/index.ts";
