export type PastedSource = { mediaType: string; data: string }

const IMAGE_REF = /\[Image #(\d+)\]/g
const CELL_RATIO = 0.46
const PX_PER_ROW = 22
export const PREVIEW_ROWS = 12

export const imageRefs = (text: string): number[] => [...text.matchAll(IMAGE_REF)].map(m => Number(m[1]))

type Block = { type: string; [field: string]: unknown }
type Message = { role: string; content: readonly Block[] }

export const pastedImages = (messages: readonly Message[]): Map<number, PastedSource> => {
  const found = new Map<number, PastedSource>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    const refs = imageRefs(message.content.flatMap(b => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n'))
    const images = message.content.flatMap(b => {
      const source = b.type === 'image' ? (b.source as { type?: string; media_type?: string; data?: string } | undefined) : undefined
      return source?.type === 'base64' && source.data && source.media_type ? [{ mediaType: source.media_type, data: source.data }] : []
    })
    refs.slice(0, images.length).forEach((id, k) => found.set(id, images[k]!))
  }
  return found
}

export const fitPreview = (size: { width: number; height: number }, columns: number, maxRows = PREVIEW_ROWS): { columns: number; rows: number } | null => {
  const room = Math.min(255, columns)
  if (room < 4 || size.width < 1 || size.height < 1) return null
  const aspect = size.width / size.height / CELL_RATIO
  let rows = Math.max(1, Math.min(maxRows, Math.ceil(size.height / PX_PER_ROW)))
  if (Math.round(aspect * rows) > room) rows = Math.max(1, Math.floor(room / aspect))
  return { columns: Math.max(1, Math.min(room, Math.round(aspect * rows))), rows }
}
