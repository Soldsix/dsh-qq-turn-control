/** Browser-safe operator settings shared with the native form. */
export interface Settings{enabled:boolean;quoteWindowMs:number;maxScopes:number;maxRepliesPerScope:number;intentEnabled:boolean;contextWindowMs:number;maxContextMessages:number;maxContextChars:number;botIds:string[];botWindowMs:number;maxBotReplies:number;maxBotGroupReplies:number;ambientWindowMs:number;minAmbientGapMs:number;maxAmbientReplies:number}
/** Editable fields and their native representations. */
export const FIELDS={enabled:'boolean',quoteWindowMs:'number',maxScopes:'number',maxRepliesPerScope:'number',intentEnabled:'boolean',contextWindowMs:'number',maxContextMessages:'number',maxContextChars:'number',botIds:'list',botWindowMs:'number',maxBotReplies:'number',maxBotGroupReplies:'number',ambientWindowMs:'number',minAmbientGapMs:'number',maxAmbientReplies:'number'} as const satisfies Record<keyof Settings,string>
/** Editable field identity. */
export type Field=keyof Settings
