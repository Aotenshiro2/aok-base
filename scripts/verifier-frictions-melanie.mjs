// Verification des frictions de Melanie avec Agent AOK (20/11/2026) :
// 1b jamais de numero de compte demande, 1c message renvoye a l'identique,
// A deux echanges au plus, B « combien a X EUR » = ce qui est reellement paye,
// 2 resume du matin court pour Melanie, 3 une alerte du support par fil et
// par 10 minutes (route du site). Regles pures et controle statique.
// Aucune base, aucun reseau. Lancement : node scripts/verifier-frictions-melanie.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CONSIGNE_MESSAGE_RENVOYE, LONGUEUR_MIN_RENVOI, messageRenvoye, texteDuMessage } from '../src/lib/agent-cockpit-pur.ts'
import {
  DEBUT_RESTE_A_CONTACTER, MARQUEUR_RESUME_HISTORIQUE, MAX_A_CONTACTER_COURT, RUBRIQUES_ACTION,
  composerResume, composerResumeCourt, entreesHistoriqueResume, ligneRelances,
} from '../src/lib/liveclub/resume-pur.ts'
import * as S from '../src/lib/liveclub/support-pont-pur.ts'

let n = 0
function test(nom, f) {
  f()
  n++
  console.log(`ok  ${nom}`)
}
const SOBRE = (s) => !/[—–]/.test(s) && !/\p{Extended_Pictographic}/u.test(s)
const ici = path.dirname(fileURLToPath(import.meta.url))
const lire = (p) => readFileSync(path.join(ici, '..', p), 'utf8')
const AGENT = lire('src/lib/agent-cockpit.ts')
const RESUME = lire('src/lib/liveclub/resume.ts')
const ESCALADE = lire('src/app/api/support/escalate/route.ts')

// --- 1b. Jamais de numero de compte demande ---------------------------------------

test('1b : la consigne interdit de demander un numero de compte et propose un candidat par nom', () => {
  assert.match(AGENT, /JAMAIS DE NUMÉRO DE COMPTE À DEMANDER/)
  assert.match(AGENT, /ne demande JAMAIS un numéro de compte Telegram \(u123…\)/)
  assert.match(AGENT, /propose le candidat que tu trouves par nom dans le registre du groupe/)
  assert.match(AGENT, /demande seulement « son nom tel qu'il apparaît dans le groupe »/)
  assert.doesNotMatch(AGENT, /demande-le au lieu d'en deviner un/)
  assert.doesNotMatch(AGENT, /demande le compte Telegram de la personne/)
})

// --- 1c. Message renvoye a l'identique ---------------------------------------------

const DEMANDE = "Montana@exemple.fr Tu peux l'ajouter au groupe il etait entre depuis le debut"
test('1c : meme message, a la casse et aux espaces pres, apres une reponse = renvoye', () => {
  assert.equal(messageRenvoye([
    { role: 'user', content: DEMANDE },
    { role: 'assistant', content: 'Il me faut son compte Telegram.' },
    { role: 'user', content: `  ${DEMANDE.toUpperCase().replace(/ /g, '   ')} ` },
  ]), true)
})
test('1c : les lignes [système] et les blocs texte sont pris en compte', () => {
  assert.equal(messageRenvoye([
    { role: 'user', content: [{ type: 'text', text: DEMANDE }] },
    { role: 'assistant', content: 'Question ?' },
    { role: 'user', content: "[système] Alerte du support (un membre demande un humain...)" },
    { role: 'assistant', content: 'Un membre demande un humain.' },
    { role: 'user', content: DEMANDE },
  ]), true)
  assert.equal(texteDuMessage([{ type: 'tool_result', content: 'x' }]), null)
})
test('1c : un message different, un « oui » repete, ou deux messages sans reponse entre = non', () => {
  assert.equal(messageRenvoye([
    { role: 'user', content: DEMANDE }, { role: 'assistant', content: 'Q ?' }, { role: 'user', content: `${DEMANDE} merci` },
  ]), false)
  assert.ok('oui'.length < LONGUEUR_MIN_RENVOI)
  assert.equal(messageRenvoye([
    { role: 'user', content: 'oui' }, { role: 'assistant', content: 'Q ?' }, { role: 'user', content: 'Oui' },
  ]), false)
  assert.equal(messageRenvoye([{ role: 'user', content: DEMANDE }, { role: 'user', content: DEMANDE }]), false)
  assert.equal(messageRenvoye([{ role: 'user', content: DEMANDE }]), false)
  assert.equal(messageRenvoye([]), false)
})
test('1c : la note au modele part dans boucleAgent, sans appel en plus', () => {
  assert.ok(SOBRE(CONSIGNE_MESSAGE_RENVOYE))
  assert.match(CONSIGNE_MESSAGE_RENVOYE, /Ne repose pas la même question/)
  assert.match(CONSIGNE_MESSAGE_RENVOYE, /UNE seule option/)
  const boucle = AGENT.slice(AGENT.indexOf('export async function boucleAgent('))
  assert.match(boucle, /if \(messageRenvoye\(historique\)\) systeme\.push\(\{ type: 'text', text: CONSIGNE_MESSAGE_RENVOYE \}\)/)
})

// --- A. Deux echanges au plus -------------------------------------------------------

test('A : la regle des deux echanges est en tete du prompt, pour toutes les demandes', () => {
  const i = AGENT.indexOf('DEUX ÉCHANGES AU PLUS')
  assert.ok(i > 0 && i < AGENT.indexOf('LA SÉCURITÉ : QUI TE DONNE DES ORDRES'))
  const bloc = AGENT.slice(i, AGENT.indexOf('LE RÉSUMÉ DU MATIN COURT'))
  assert.match(bloc, /UN seul tour de précision ou de validation, qui regroupe en une fois TOUT ce qui manque/)
  assert.match(bloc, /dès ta PREMIÈRE réponse/)
  assert.match(bloc, /la lecture la plus naturelle/)
  assert.match(bloc, /c'est la carte, jamais une question en plus/)
  assert.ok(SOBRE(bloc))
})

// --- B. Combien a X EUR ------------------------------------------------------------

test('B : montant = prix du tarif, montant_paye = reellement paye ; la regle de comptage', () => {
  assert.match(AGENT, /montant \(PRIX DU TARIF, avant remise\), montant_paye \(ce que l'abonnement paie RÉELLEMENT/)
  assert.match(AGENT, /remise_code .*remise .*remise_fin/)
  assert.match(AGENT, /« COMBIEN DE MEMBRES À X € »/)
  assert.match(AGENT, /Compte sur montant_paye = X \(abonnements vivants, hors pause\), jamais sur montant/)
  assert.match(AGENT, /montant = X et montant_paye < X/)
})

// --- 2. Le resume du matin court ---------------------------------------------------

const Q = '2026-11-18T06:00:00.000Z'
const ev = (rubrique, qui, detail, extra = {}) => ({ rubrique, qui, detail, quand: Q, ...extra })
const personnes = new Map(Array.from({ length: 12 }, (_, i) => [`m${i}`, { nom: `Membre ${i}`, email: null, pseudo: null, telegramId: null }]))
const o = { depuis: '2026-11-17T06:00:00.000Z', jusqua: Q }

test('2 : seulement les rubriques d action ; pas de « Bientôt »', () => {
  const evs = [
    ev('nouveaux', 'm0', 'nouveau, abonné 139 EUR'),
    ev('pauses', 'm1', 'pause jusqu au 01/12'),
    ev('sorties', 'm2', 'sorti du groupe'),
    ev('contacter', 'm3', 'prélèvement dans 14 jours, rien écrit depuis 30 j'),
  ]
  const c = composerResumeCourt(evs, personnes, o)
  assert.ok(c)
  assert.doesNotMatch(c.texte, /Arrivées|Pauses|Sorties|Bientôt/)
  assert.match(c.texte, /À contacter\n- Membre 3/)
  assert.deepEqual(c.reste, [])
  assert.ok(RUBRIQUES_ACTION.has('humains') && !RUBRIQUES_ACTION.has('nouveaux'))
  // La version complete (Brice) ne change pas.
  const complet = composerResume(evs, personnes, { ...o, bientot: 20 })
  assert.match(complet, /Arrivées/)
  assert.match(complet, /Bientôt : 20 membres/)
})
test('2 : rien a faire pour elle = pas de message', () => {
  assert.equal(composerResumeCourt([ev('nouveaux', 'm0', 'nouveau'), ev('sorties', 'm1', 'sorti')], personnes, o), null)
  // Les relances d'Alex seules ne demandent rien.
  assert.equal(composerResumeCourt([ev('contacter', 'm0', "silencieux depuis 15 jours (Alex s'en occupe)", { relais: ['Alex'] })], personnes, o), null)
})
test('2 : « Alex s en occupe » regroupe en une ligne', () => {
  const c = composerResumeCourt([
    ev('contacter', 'm0', "silencieux depuis 15 jours (Alex s'en occupe)", { relais: ['Alex'] }),
    ev('contacter', 'm1', "silencieux depuis 16 jours (Alex s'en occupe)", { relais: ['Alex'] }),
    ev('contacter', 'm2', "nouveau, pas encore un mot (Alex s'en occupe)", { relais: ['Alex'] }),
    ev('contacter', 'm3', 'paiement en échec'),
  ], personnes, o)
  assert.doesNotMatch(c.texte, /s'en occupe/)
  assert.match(c.texte, /- Membre 3 : paiement en échec\n- 3 relances en cours chez Alex$/)
  assert.equal(ligneRelances(new Map([['Alex', 2], ['Sam', 1]])), '2 relances en cours chez Alex, 1 chez Sam')
  assert.equal(ligneRelances(new Map([['Alex', 1]])), '1 relance en cours chez Alex')
  assert.equal(ligneRelances(new Map()), null)
})
test('2 : « À contacter » plafonne a 5 lignes, le reste garde pour « la suite »', () => {
  const evs = Array.from({ length: 9 }, (_, i) => ev('contacter', `m${i}`, `silencieux depuis ${20 + i} jours`))
  const c = composerResumeCourt(evs, personnes, o)
  const lignes = c.texte.split('\n').filter(l => l.startsWith('- '))
  assert.equal(lignes.length, MAX_A_CONTACTER_COURT + 1)
  assert.equal(lignes[MAX_A_CONTACTER_COURT], '- et 4 autres : dis « la suite »')
  assert.equal(c.reste.length, 4)
  assert.match(c.reste[0], /^- Membre 5 : silencieux depuis 25 jours$/)
  assert.ok(SOBRE(c.texte))
  // L'historique garde le reste derriere le marqueur, pour l'agent.
  const h = entreesHistoriqueResume(c.texte, '2026-11-18', c.reste)
  assert.ok(h[0].content.startsWith(MARQUEUR_RESUME_HISTORIQUE))
  assert.ok(h[0].content.includes(`${DEBUT_RESTE_A_CONTACTER} (4)`))
  assert.ok(h[0].content.endsWith(c.reste.join('\n')))
  assert.equal(h[1].content, c.texte)
  // Sans reste : le marqueur d'avant, inchange.
  assert.equal(entreesHistoriqueResume('x', '2026-11-18')[0].content, MARQUEUR_RESUME_HISTORIQUE)
  // L'agent sait servir « la suite ».
  assert.match(AGENT, /Quand elle dit « la suite » sous ce résumé, donne-lui les lignes gardées/)
})
test('2 : resume.ts envoie la version courte a Melanie seulement, Brice garde la complete', () => {
  assert.match(RESUME, /select telegram_id, libelle from public\.cockpit_telegram_comptes where diffusion = 'equipe'/)
  assert.match(RESUME, /const pourMelanie = estMelanie\(d\.libelle\)/)
  assert.match(RESUME, /if \(pourMelanie && !court\) continue/)
  assert.match(RESUME, /const aEnvoyer = pourMelanie && court \? decouperResume\(court\.texte\) : messages/)
  assert.match(RESUME, /entreesHistoriqueResume\(court\.texte, jour, court\.reste\)/)
  assert.match(RESUME, /rubrique: 'contacter', qui: `m\$\{m\.membreId\}`, quand: jusqua\.toISOString\(\), detail, relais \}/)
})

// --- 3. Une alerte par fil et par 10 minutes (support du site) ---------------------

test('3 : la ligne posee par la route est celle que lit alerteAutorisee', () => {
  const T0 = Date.UTC(2026, 10, 11, 9, 0)
  const membre = { role: 'user', content: 'je veux un humain', at: new Date(T0).toISOString() }
  const fil = [membre]
  assert.equal(S.alerteAutorisee(fil, T0), true)
  fil.push(S.ligneEquipePrevenue(new Date(T0).toISOString()))
  assert.equal(S.alerteAutorisee(fil, T0 + 2400), false, 'deuxieme appel a 2,4 s : pas d alerte')
  assert.equal(S.alerteAutorisee(fil, T0 + 9 * 60_000), false)
  assert.equal(S.alerteAutorisee(fil, T0 + 10 * 60_000), true)
  assert.equal(S.ligneEquipePrevenue('x').content, `${S.PREFIXE_SYSTEME}${S.LIGNE_EQUIPE_PREVENUE}`)
})
test('3 : la route du site verifie avant l email et le Telegram, et pose la ligne avant l envoi', () => {
  const iAutorise = ESCALADE.indexOf('alerteAutorisee(thread.messages, Date.now())')
  const iLigne = ESCALADE.indexOf('ligneEquipePrevenue(new Date().toISOString())')
  const iEmail = ESCALADE.indexOf('resend.emails.send(')
  const iTelegram = ESCALADE.indexOf('alerterEquipeTelegram({')
  assert.ok(iAutorise > 0 && iAutorise < iLigne && iLigne < iEmail && iEmail < iTelegram)
  assert.match(ESCALADE, /const apiKey = dejaPrevenue \? undefined :/)
  assert.match(ESCALADE, /if \(!dejaPrevenue\) try \{/)
  assert.match(ESCALADE, /let notified = dejaPrevenue/)
})

console.log(`\n${n} blocs ok`)
