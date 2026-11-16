'use client'

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  codeDansEmail, codeSaisi, estGmail, lienEcrisNous, LONGUEUR_CODE, TEXTES as T, texteDejaParti, textePlafond, texteRenvoi,
  type Envoi, type IssueCode,
} from '@/lib/connexion-page-pur'
import { quandConnecte, verifierCode } from '@/lib/connexion-page'

// Les écrans de la connexion par adresse du journal (16/11/2026), repris de
// components/connexion/Ecrans.tsx du site, dans le look de la page /auth du
// journal (tokens canvas, jaune #fcdf3e, bouton Google blanc) :
// - RegardeTaBoite : l'email est parti, le champ du code à 6 chiffres quand
//   l'email en contient un, « Renvoyer » après 60 s, « Changer d'adresse », et
//   en bas « Toujours bloqué ? Écris-nous » ;
// - PorteGoogle : un compte Google (ou une création avec un Gmail) ;
// - AdresseInconnue, AdresseRattachee.

export const styleChamp: CSSProperties = {
  background: 'var(--node-bg)',
  border: '1px solid var(--node-border)',
  color: 'var(--node-title)',
}

export const C = {
  champ: 'w-full px-3 py-2.5 rounded-lg text-sm placeholder-gray-400 focus:outline-none',
  principal: 'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed',
  google: 'w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white text-gray-900 font-medium text-sm hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
  secondaire: 'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed',
  lien: 'block w-full text-center text-xs underline underline-offset-4 transition-colors disabled:opacity-40',
  erreur: 'text-sm text-red-400',
  ok: 'text-sm text-green-500',
}

export const S: Record<string, CSSProperties> = {
  principal: { background: '#fcdf3e', color: '#1a1a1a' },
  secondaire: { background: 'transparent', color: 'var(--node-title)', border: '1px solid var(--float-border)' },
  lien: { color: 'var(--node-meta)' },
  titre: { color: 'var(--node-title)' },
  texte: { color: 'var(--node-meta)' },
  fort: { color: 'var(--node-title)' },
}

export function IconeGoogle() {
  return (
    <svg className="w-5 h-5" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

/** Le petit cercle qui tourne (sombre sur le jaune, clair ailleurs). */
export function Tourne({ clair = false }: { clair?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block align-[-2px] w-4 h-4 border-2 border-t-transparent rounded-full animate-spin ${clair ? 'border-gray-400' : 'border-gray-700'}`}
    />
  )
}

/** « Toujours bloqué ? Écris-nous » : en bas de chaque écran. */
function Pied() {
  return (
    <p className="pt-4 mt-2 text-center" style={{ borderTop: '1px solid var(--float-border)' }}>
      <a href={lienEcrisNous()} className="text-xs underline underline-offset-4" style={S.lien}>{T.ecrisNous}</a>
    </p>
  )
}

function Titre({ children }: { children: ReactNode }) {
  return <h2 className="text-base font-semibold" style={S.titre}>{children}</h2>
}

function Texte({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return <p className="text-sm leading-relaxed break-words" style={S.texte} aria-live={live ? 'polite' : undefined}>{children}</p>
}

// ---------------------------------------------------------------- Regarde ta boîte

export function RegardeTaBoite({
  email, envoi, restant, onRenvoyer, onChanger, onGoogle, onConnecte,
}: {
  email: string
  envoi: 'attente' | Envoi
  /** Secondes avant de pouvoir renvoyer (décompte de cette adresse). */
  restant: number
  onRenvoyer: () => void
  onChanger?: () => void
  /** Adresse Gmail : la porte Google (petite, et en avant au plafond). */
  onGoogle?: () => void
  /** Session ouverte (code juste, ou lien ouvert dans un autre onglet). */
  onConnecte: (user: User | null) => void
}) {
  const idCode = useId()
  const [code, setCode] = useState('')
  const [verif, setVerif] = useState<'repos' | 'attente' | IssueCode>('repos')

  // Une seule fois : le code juste ET le lien ouvert dans un autre onglet préviennent tous deux.
  const fait = useRef(false)
  const surConnecte = useRef(onConnecte)
  useEffect(() => { surConnecte.current = onConnecte })
  const connecter = useCallback((u: User | null) => {
    if (fait.current) return
    fait.current = true
    surConnecte.current(u)
  }, [])
  useEffect(() => quandConnecte(u => connecter(u)), [connecter])

  const issue = envoi === 'attente' ? null : envoi
  const parti = issue !== null && (issue.t === 'ok' || issue.t === 'delai')
  const voie = issue && (issue.t === 'ok' || issue.t === 'delai') ? issue.voie : null
  const avecCode = voie ? codeDansEmail(voie) : false
  const gmail = estGmail(email) && Boolean(onGoogle)

  async function valider(c: string) {
    if (c.length !== LONGUEUR_CODE || verif === 'attente' || fait.current) return
    setVerif('attente')
    const r = await verifierCode(email, c)
    setVerif(r.t === 'ok' ? { t: 'ok' } : r)
    if (r.t === 'ok') connecter(r.user ?? null)
  }

  function saisir(v: string) {
    const c = codeSaisi(v)
    setCode(c)
    if (verif !== 'attente') setVerif('repos')
    if (c.length === LONGUEUR_CODE) void valider(c)
  }

  function renvoyer() {
    setCode('')
    setVerif('repos')
    onRenvoyer()
  }

  const titre = !issue || parti ? T.boite.titre : issue.t === 'plafond' ? T.boite.titrePlafond : T.boite.titreErreur

  return (
    <div className="space-y-4">
      <Titre>{titre}</Titre>

      {envoi === 'attente' && <Texte live><Tourne clair /> {T.boite.attente}</Texte>}

      {issue && parti && (
        <>
          <Texte live>
            {issue.t === 'ok'
              ? <>{T.boite.envoye} <strong className="font-semibold" style={S.fort}>{email}</strong>.</>
              : texteDejaParti(restant)}
          </Texte>
          <Texte>{voie === 'aok' ? T.boite.attenduAok : T.boite.attenduSupabase}</Texte>
          {avecCode ? (
            <>
              <form className="space-y-3" onSubmit={e => { e.preventDefault(); void valider(code) }}>
                <label htmlFor={idCode} className="block text-xs mb-1" style={S.texte}>{T.boite.codeLabel}</label>
                <input
                  id={idCode}
                  className={`${C.champ} text-2xl text-center tracking-[0.3em]`}
                  style={styleChamp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="go"
                  placeholder="000000"
                  value={code}
                  onChange={e => saisir(e.target.value)}
                  disabled={verif === 'attente' || (typeof verif === 'object' && verif.t === 'ok')}
                />
                <button type="submit" className={C.principal} style={S.principal} disabled={code.length !== LONGUEUR_CODE || verif === 'attente'}>
                  {verif === 'attente' ? <><Tourne /> {T.boite.verification}</> : T.boite.valider}
                </button>
                {typeof verif === 'object' && verif.t !== 'ok' && (
                  <p role="alert" className={C.erreur}>{T.code[verif.t]}</p>
                )}
                {typeof verif === 'object' && verif.t === 'ok' && <p className={C.ok}>{T.boite.connecte}</p>}
              </form>
              <Texte>{voie === 'aok' ? T.boite.ouLienAok : T.boite.ouLienSupabase}</Texte>
            </>
          ) : (
            <Texte>{T.boite.lienSeul}</Texte>
          )}
          <Texte>{T.boite.dernier}</Texte>
        </>
      )}

      {issue?.t === 'plafond' && (
        <>
          <p role="alert" className={C.erreur}>
            {textePlafond()}{gmail ? ` ${T.plafondGmail}` : ''}
          </p>
          {gmail && (
            <button type="button" className={C.google} onClick={onGoogle}><IconeGoogle /> {T.google.bouton}</button>
          )}
          <a href={lienEcrisNous()} className={gmail ? C.secondaire : C.principal} style={gmail ? S.secondaire : S.principal}>{T.ecrisNousBouton}</a>
        </>
      )}

      {issue?.t === 'erreur' && (
        <p role="alert" className={C.erreur}>{issue.message === 'invalide' ? T.boite.adresseInvalide : T.boite.erreurEnvoi}</p>
      )}

      {issue && (
        <button
          type="button"
          className={issue.t === 'plafond' ? C.lien : C.secondaire}
          style={issue.t === 'plafond' ? S.lien : S.secondaire}
          disabled={restant > 0}
          onClick={renvoyer}
        >
          {restant > 0 ? texteRenvoi(restant) : T.boite.renvoyer}
        </button>
      )}
      {gmail && issue && issue.t !== 'plafond' && (
        <button type="button" className={C.lien} style={S.lien} onClick={onGoogle}>{T.googleGmail}</button>
      )}
      {onChanger && <button type="button" className={C.lien} style={S.lien} onClick={onChanger}>{T.changer}</button>}

      {issue?.t !== 'plafond' && <Pied />}
    </div>
  )
}

// ---------------------------------------------------------------- Google

export function PorteGoogle({
  email, creation = false, erreur = null, attente = false, onGoogle, onCode, onChanger,
}: {
  email: string
  /** Adresse inconnue, « Créer un compte » avec un Gmail. */
  creation?: boolean
  erreur?: string | null
  attente?: boolean
  onGoogle: () => void
  /** « Recevoir un code par email à la place ». */
  onCode: () => void
  onChanger?: () => void
}) {
  return (
    <div className="space-y-4">
      <Titre>{creation ? T.creerGoogle.titre : T.google.titre}</Titre>
      <Texte>{creation ? T.creerGoogle.texte : T.google.texte}</Texte>
      <Texte><strong className="font-semibold" style={S.fort}>{email}</strong></Texte>
      <button type="button" className={C.google} onClick={onGoogle} disabled={attente}>
        {attente ? <Tourne clair /> : <IconeGoogle />} {T.google.bouton}
      </button>
      {erreur && <p role="alert" className={C.erreur}>{erreur}</p>}
      <button type="button" className={C.lien} style={S.lien} onClick={onCode} disabled={attente}>{T.google.autreCode}</button>
      {onChanger && <button type="button" className={C.lien} style={S.lien} onClick={onChanger}>{T.changer}</button>}
      <Pied />
    </div>
  )
}

// ---------------------------------------------------------------- Inconnue

export function AdresseInconnue({
  email, newsletter, onNewsletter, onEssayer, onCreer,
}: {
  email: string
  newsletter?: boolean
  onNewsletter?: (v: boolean) => void
  /** « Essayer une autre adresse » : retour au champ. */
  onEssayer: () => void
  /** « Créer un compte gratuit avec cette adresse ». */
  onCreer: () => void
}) {
  return (
    <div className="space-y-4">
      <Titre>{T.inconnue.titre}</Titre>
      <Texte><strong className="font-semibold" style={S.fort}>{email}</strong></Texte>
      <Texte>{T.inconnue.texte}</Texte>
      <button type="button" className={C.principal} style={S.principal} onClick={onEssayer}>{T.inconnue.essayer}</button>
      <button type="button" className={C.secondaire} style={S.secondaire} onClick={onCreer}>{T.inconnue.creer}</button>
      {onNewsletter && (
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 rounded"
            style={{ accentColor: '#fcdf3e' }}
            checked={Boolean(newsletter)}
            onChange={e => onNewsletter(e.target.checked)}
          />
          <span className="text-xs" style={S.texte}>{T.inconnue.newsletter}</span>
        </label>
      )}
      <Pied />
    </div>
  )
}

// ---------------------------------------------------------------- Rattachée

export function AdresseRattachee({ onAutre, onGoogle }: {
  /** « Me connecter avec une autre adresse ». */
  onAutre: () => void
  onGoogle: () => void
}) {
  return (
    <div className="space-y-4">
      <Titre>{T.rattachee.titre}</Titre>
      <Texte>{T.rattachee.texte}</Texte>
      <button type="button" className={C.principal} style={S.principal} onClick={onAutre}>{T.rattachee.autre}</button>
      <button type="button" className={C.google} onClick={onGoogle}><IconeGoogle /> {T.google.bouton}</button>
      <Pied />
    </div>
  )
}
