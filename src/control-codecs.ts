/** Strict JSON codecs are shared by the owner Host and browser. */
import * as z from 'zod/mini'
import type {Settings} from './fields.ts'
import type {Snapshot,SaveRequest} from './control-types.ts'
const config=z.strictObject({enabled:z.boolean(),quoteWindowMs:z.int(),maxScopes:z.int(),maxRepliesPerScope:z.int()} satisfies {[Key in keyof Settings]:z.ZodMiniType<Settings[Key]>})
const revision=z.string().check(z.regex(/^[a-f0-9]{64}$/))
/** Only declared fields may be saved. */
export const saveSchema:z.ZodMiniType<SaveRequest>=z.strictObject({revision,patch:z.pipe(z.partial(config),z.transform(value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined)) as Partial<Settings>))})
/** Metadata is validated before rendering. */
export const snapshotSchema:z.ZodMiniType<Snapshot>=z.strictObject({config,revision,active:z.boolean(),entryDisabled:z.boolean(),refreshMs:z.int().check(z.minimum(250),z.maximum(60000))})
