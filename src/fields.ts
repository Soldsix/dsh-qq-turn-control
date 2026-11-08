/** Browser-safe operator settings shared with the native form. */
export interface Settings{enabled:boolean;quoteWindowMs:number;maxScopes:number;maxRepliesPerScope:number;intentEnabled:boolean;contextWindowMs:number;maxContextMessages:number;maxContextChars:number}
/** Editable fields and their native representations. */
export const FIELDS={enabled:'boolean',quoteWindowMs:'number',maxScopes:'number',maxRepliesPerScope:'number',intentEnabled:'boolean',contextWindowMs:'number',maxContextMessages:'number',maxContextChars:'number'} as const satisfies Record<keyof Settings,string>
/** Editable field identity. */
export type Field=keyof Settings
