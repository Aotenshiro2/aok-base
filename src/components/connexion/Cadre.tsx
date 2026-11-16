import type { ReactNode } from 'react'

// Le cadre des pages de connexion du journal (/auth, /auth/carnet) : le fond
// canvas de la landing (aurore, grille de points) et la carte vitrée avec le
// logo. Repris tel quel de l'ancienne page /auth (aucun visuel nouveau).
export function CadreConnexion({ children }: { children: ReactNode }) {
  return (
    <div
      className="dark"
      style={{
        position: 'relative', minHeight: '100dvh', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: 'radial-gradient(130% 120% at 50% 6%, #121214 0%, #050506 55%, #000000 100%)',
      }}
    >
      {/* Même fond canvas que la landing : l'auth « apparaît » sur le canvas, pas de rupture */}
      <div className="canvas-aurora"><span className="aurora-blob" /></div>
      <div className="canvas-grid-dots" style={{ backgroundSize: '22px 22px' }} />
      <div className="canvas-top-gradient" />

      <div
        className="canvas-float-pill"
        style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 380, padding: 32, borderRadius: 18 }}
      >
        {/* Logo / titre */}
        <div className="mb-6 text-center">
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'rgba(252, 223, 62, 0.12)', border: '1px solid rgba(252, 223, 62, 0.30)' }}
          >
            <span className="text-2xl">📚</span>
          </div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--node-title)' }}>AOKnowledge</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--node-meta)' }}>Journal d&#39;Études</p>
        </div>

        {children}
      </div>
    </div>
  )
}
