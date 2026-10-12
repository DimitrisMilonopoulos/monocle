import type { ClientModule } from 'claude-code'

type ZoomProps = { id: string; columns: number; rows: number }

const Zoom: ClientModule<ZoomProps, true> = (props, surface) => {
  if (surface.state === undefined) {
    surface.onPointer(e => {
      if (e.type === 'up' && e.button === 'left') surface.post({ zoom: props.id })
    })
    surface.setState(true)
  }
  return surface.elements.Box({ width: props.columns, height: props.rows })
}

export default Zoom
