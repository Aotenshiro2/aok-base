'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  adresseValide, cheminRetourSur, cleAdresse, DELAI_RENVOI_S, estGmail, issueEnvoi, messageOubli,
  TEXTES as T, texteRenvoi,
} from '@/lib/connexion-page-pur'
import { continuerAvecGoogle, DEMO, reconnaitreAdresse } from '@/lib/connexion-page'
import { useDecompteRenvoi } from '@/hooks/useDecompteRenvoi'
import { useEnvoiCode } from '@/hooks/useEnvoiCode'
import {
  AdresseInconnue, AdresseRattachee, C, PorteGoogle, RegardeTaBoite, S, styleChamp, Tourne,
} from '@/components/connexion/Ecrans'

// La page de connexion du journal reconnaît l'adresse (16/11/2026, brief
// 2026-11-16-connexion-ecosysteme : le parcours de aoknowledge.com/connexion,
// le look du journal). Un champ email et « Continuer ». La page demande à la
// route du journal /api/connexion/adresse ce que l'écosystème sait de
// l'adresse et montre UNE porte :
// - google    : « Continuer avec Google », le code par email en second ;
// - connue    : le code part tout de suite, écran « Regarde ta boîte » ;
// - inconnue  : « On ne connaît pas cette adresse », essayer celle du paiement
//               d'abord, puis « Créer un compte gratuit avec cette adresse » :
//               c'est LA création de compte du journal ;
// - rattachee : adresse secondaire d'un compte, jamais de second compte ;
// - simple    : la route ne répond pas, le code part (repli signInWithOtp).
// Le mot de passe reste possible, en lien secondaire, avec « Mot de passe
// oublié ? » (même lien de Supabase qu'avant, vers /auth/reset-password).
// Le lien de l'email revient sur /auth/lien. Google et le repli gardent
// /auth/callback (échange PKCE côté serveur), comme avant.

type Ecran = 'adresse' | 'verif' | 'google' | 'boite' | 'inconnue' | 'creerGoogle' | 'rattachee'

function AuthPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Retour après connexion (?redirectTo=, posé par le middleware et la landing ; chemins internes seulement).
  const retour = cheminRetourSur(searchParams.get('redirectTo'))

  const [ecran, setEcran] = useState<Ecran>('adresse')
  const [email, setEmail] = useState('')
  const adresse = email.trim()
  const [newsletter, setNewsletter] = useState(false)
  const [versGoogle, setVersGoogle] = useState(false)
  const [erreurGoogle, setErreurGoogle] = useState<string | null>(null)
  const envoi = useEnvoiCode()

  // Le mot de passe, en lien secondaire.
  const [motDePasse, setMotDePasse] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  // ?error= : retour de Google ou du repli (/auth/callback), ou d'un lien de l'email (/auth/lien).
  const [error, setError] = useState<string | null>(() => {
    const e = searchParams.get('error')
    if (e === 'lien_expire') return T.lienExpire
    if (e === 'auth_callback_failed') return T.connexionEchouee
    return null
  })
  const [success, setSuccess] = useState<string | null>(null)
  // « Mot de passe oublié ? » : son lien et le code partagent le même jeton chez Supabase,
  // l'un annule l'autre. Il attend donc le décompte de l'un comme de l'autre.
  const decompteOubli = useDecompteRenvoi()
  const restantOubli = Math.max(envoi.restant(adresse), decompteOubli.cle === cleAdresse(adresse) ? decompteOubli.restant : 0)

  /** Connecté (code juste, ou lien ouvert dans un autre onglet). */
  function arriver() {
    if (DEMO) return
    router.push(retour ?? '/')
  }

  function changer() {
    setEcran('adresse')
    setErreurGoogle(null)
    setVersGoogle(false)
  }

  async function continuer() {
    if (ecran === 'verif') return
    setSuccess(null)
    if (!adresseValide(adresse)) {
      setError(T.boite.adresseInvalide)
      return
    }
    setError(null)
    setEcran('verif')
    const r = await reconnaitreAdresse(adresse)
    if (r === 'google') setEcran('google')
    else if (r === 'inconnue') setEcran('inconnue')
    else if (r === 'rattachee') setEcran('rattachee')
    else void recevoirCode() // connue, ou la route ne répond pas : le parcours simple
  }

  // creer : le membre a choisi « Créer un compte gratuit » (gardé pour « Renvoyer »).
  const [creation, setCreation] = useState(false)

  async function recevoirCode(creer = false, renvoi = false) {
    setEcran('boite')
    setCreation(creer)
    // Revenir sur la même adresse moins d'une minute après : rien ne repart (un envoi annulerait le précédent).
    if (!renvoi && envoi.dejaParti(adresse)) return
    const r = await envoi.envoyer(adresse, { creer, newsletter: creer && newsletter, retour })
    if (r.t === 'rattachee') setEcran('rattachee')
    else if (r.t === 'inconnue') setEcran('inconnue')
    else if (creer && !renvoi && r.t === 'ok' && newsletter && !DEMO) {
      // Comme avant : l'inscription à la newsletter juste après la création du compte
      // (la route vérifie le compte de moins de 24 h qui a coché la case).
      fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adresse }),
      }).catch(() => {})
    }
  }

  function creer() {
    // Un Gmail : Google crée le compte sans email à attendre (le code reste possible).
    if (estGmail(adresse)) setEcran('creerGoogle')
    else void recevoirCode(true)
  }

  async function google(avecAdresse = true) {
    setVersGoogle(true)
    setErreurGoogle(null)
    const e = await continuerAvecGoogle(avecAdresse ? adresse : null)
    if (e) {
      setErreurGoogle(e)
      setVersGoogle(false)
    }
  }

  const handleEmailSignIn = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    const { error } = await createClient().auth.signInWithPassword({ email: adresse, password })
    if (error) {
      // Cas typique : compte créé avec Google ou par code, donc sans mot de passe.
      const invalidCredentials =
        error.code === 'invalid_credentials' || error.message === 'Invalid login credentials'
      setError(invalidCredentials ? T.motDePasseFaux : error.message)
      setLoading(false)
    } else {
      router.push(retour ?? '/')
    }
  }

  // Mot de passe oublié : même champ email, même lien qu'avant (/auth/reset-password).
  const handleForgotPassword = async () => {
    setError(null)
    setSuccess(null)
    if (!adresse) {
      setError(T.oubliSansAdresse)
      return
    }
    if (restantOubli > 0) return
    setLoading(true)
    const { error } = await createClient().auth.resetPasswordForEmail(adresse, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    const issue = issueEnvoi(error)
    const m = messageOubli(issue, adresse)
    if (m.ok) setSuccess(m.texte)
    else setError(m.texte)
    if (issue.t === 'ok') decompteOubli.lancer(DELAI_RENVOI_S, cleAdresse(adresse))
    else if (issue.t === 'delai') decompteOubli.lancer(issue.secondes, cleAdresse(adresse))
    setLoading(false)
  }

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

        {(ecran === 'adresse' || ecran === 'verif') && (
          <>
            {/* Aide : les clients existants retrouvent leurs accès par l'email d'achat */}
            <p className="text-xs mb-4 text-center" style={{ color: 'var(--node-meta)' }}>{T.aide}</p>

            {/* Un champ, un bouton : la page reconnaît l'adresse */}
            <form className="space-y-3" noValidate onSubmit={e => { e.preventDefault(); void continuer() }}>
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                readOnly={ecran === 'verif'}
                className={C.champ}
                style={styleChamp}
              />
              <button type="submit" disabled={ecran === 'verif' || !adresse} className={C.principal} style={S.principal}>
                {ecran === 'verif' && <Tourne />}
                {ecran === 'verif' ? T.verification : T.continuer}
              </button>
              {error && <p role="alert" className={C.erreur}>{error}</p>}
              {success && <p className={C.ok}>{success}</p>}
            </form>

            {/* Le mot de passe, pour ceux qui en ont un : en lien secondaire */}
            {!motDePasse ? (
              <p className="mt-5 text-center">
                <button type="button" onClick={() => setMotDePasse(true)} className="text-xs underline underline-offset-4" style={S.lien}>
                  {T.motDePasse}
                </button>
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px" style={{ background: 'var(--float-border)' }} />
                  <span className="text-xs" style={S.lien}>{T.avecMotDePasse}</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--float-border)' }} />
                </div>
                {/* L'email est le champ unique en haut */}
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    placeholder="Mot de passe"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && adresse && password && handleEmailSignIn()}
                    className={`${C.champ} pr-10`}
                    style={styleChamp}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    style={S.lien}
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleEmailSignIn}
                  disabled={loading || ecran === 'verif' || !adresse || !password}
                  className={C.secondaire}
                  style={S.secondaire}
                >
                  {loading && <Tourne clair />}
                  {T.seConnecter}
                </button>
                <p className="text-center">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={loading || restantOubli > 0}
                    className="text-xs transition-colors disabled:opacity-40"
                    style={S.lien}
                  >
                    {restantOubli > 0 ? `${T.oubli} ${texteRenvoi(restantOubli)}` : T.oubli}
                  </button>
                </p>
              </div>
            )}
          </>
        )}

        {ecran === 'boite' && (
          <RegardeTaBoite
            email={adresse}
            envoi={envoi.etat?.envoi ?? 'attente'}
            restant={envoi.restant(adresse)}
            onRenvoyer={() => void recevoirCode(creation, true)}
            onChanger={changer}
            onGoogle={() => void google()}
            onConnecte={arriver}
          />
        )}

        {(ecran === 'google' || ecran === 'creerGoogle') && (
          <PorteGoogle
            email={adresse}
            creation={ecran === 'creerGoogle'}
            erreur={erreurGoogle}
            attente={versGoogle}
            onGoogle={() => void google()}
            onCode={() => void recevoirCode(ecran === 'creerGoogle')}
            onChanger={changer}
          />
        )}

        {ecran === 'inconnue' && (
          <AdresseInconnue
            email={adresse}
            newsletter={newsletter}
            onNewsletter={setNewsletter}
            onEssayer={changer}
            onCreer={creer}
          />
        )}

        {ecran === 'rattachee' && (
          <AdresseRattachee onAutre={changer} onGoogle={() => void google(false)} />
        )}

        <p className="mt-6 text-center text-xs" style={{ color: 'var(--node-meta)', opacity: 0.75 }}>
          {T.ecosysteme}
        </p>
      </div>
    </div>
  )
}

export default function AuthPageWrapper() {
  return (
    <Suspense>
      <AuthPage />
    </Suspense>
  )
}
