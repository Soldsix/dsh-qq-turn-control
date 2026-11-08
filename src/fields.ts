/** Browser-safe operator settings shared with the native form. */
export interface Settings{enabled:boolean;quoteWindowMs:number;maxScopes:number;maxRepliesPerScope:number}
/** Editable fields and their native representations. */
export const FIELDS={enabled:'boolean',quoteWindowMs:'number',maxScopes:'number',maxRepliesPerScope:'number'} as const satisfies Record<keyof Settings,string>
/** Editable field identity. */
export type Field=keyof Settings
