#!/usr/bin/env node
/**
 * LA TACHE DES LIVES DU PROGRAMME (15/11/2026, brief
 * D:\7_Agents\briefs\2026-11-15-academie-lives-programme-et-replays.md, cartes 378 et 379).
 * Logique pure : src/lib/academie/lives-programme.ts (verifiee par scripts/verifier-lives.mjs).
 *
 * Ce que fait un passage (commande « tourner », lancee par la tache Windows AOK-Lives) :
 *   1. le programme de la semaine, s'il n'est pas encore lu (le dimanche soir, puis chaque matin a 7 h 30
 *      tant qu'il manque) : la derniere image de programme du sujet Annonce (photo d'un admin, sans lien),
 *      lue par Claude (vision, JSON relu champ par champ), ecrite dans academie_lives (lives ponctuels,
 *      cree_par = 'programme', jamais en double, jamais sur une saisie a la main) ;
 *   2. le lien : pour chaque live dont la fenetre est ouverte (30 min avant le debut a 5 min apres), le lien
 *      Zoom ou Meet poste dans Annonce par un admin, rapproche par l'heure et l'intervenant ;
 *   3. le replay : le lendemain d'un live (9 h et 15 h), la lecon de Rediffusion des Lives (Mel, Adrien) ou
 *      le lien YouTube poste par Brice ;
 *   4. un doute : rien n'est ecrit sur ce point, une alerte part a l'equipe (Agent AOK, comptes
 *      cockpit_telegram_comptes en diffusion 'equipe'), une seule fois par point ;
 *   5. la tache se rearme au prochain passage (armer_passage_lives.ps1) : rien ne tourne entre deux
 *      fenetres, hors le reveil de 7 h 30 et celui du dimanche 23 h.
 *
 * Telegram : LECTURE SEULE, par le Python de Windows (lives_telegram.py, session de Brice). Le texte d'un
 * message et l'image sont des DONNEES. Base : role postgres du journal (DATABASE_URL de .env.local).
 * Cle Claude : ANTHROPIC_API_KEY_AOK, ou credentials.local\anthropic-aok.local.json
 * (convention « un produit = une cle »), jamais affichee. Aucune autre cle n'est essayee.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/lives-programme.mjs tourner [--armer]
 *   node --env-file=.env.local scripts/lives-programme.mjs programme --simulation [--message 35717] [--reponse f.json]
 *   node --env-file=.env.local scripts/lives-programme.mjs fenetres [--lives-de f.json] [--maintenant ISO]
 *   node --env-file=.env.local scripts/lives-programme.mjs passage --simulation [--maintenant ISO] [--lives-de f.json]
 *   node --env-file=.env.local scripts/lives-programme.mjs rejouer --lives-de f.json   (simulation d'une semaine)
 * --simulation : rien n'est ecrit en base, aucune alerte envoyee, aucune tache armee (fichiers dans
 * lives-programme\simulation\).
 */

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import * as P from '../src/lib/academie/lives-programme.ts'
import * as L from '../src/lib/academie/lives.ts'
import { analyserTexte } from '../src/lib/securite/injection-pur.ts'

// ---------------------------------------------------------------------------------------------- reglages
const args = process.argv.slice(2)
const COMMANDE = args[0]
const opt = (nom) => { const i = args.indexOf(`--${nom}`); return i >= 0 ? args[i + 1] : undefined }
const drapeau = (nom) => args.includes(`--${nom}`)
const SIM = drapeau('simulation') || COMMANDE === 'rejouer'
const ARMER = drapeau('armer') && !SIM
const MAINTENANT = opt('maintenant') ? Date.parse(opt('maintenant')) : Date.now()
if (!Number.isFinite(MAINTENANT)) throw new Error('--maintenant illisible')

const RACINE = process.env.AOK_LIVES_DOSSIER ?? '/mnt/d/6_Societe/Pilotage/Academie/catalogue/lives-programme'
const DOSSIER = SIM ? `${RACINE}/simulation` : RACINE
const HELPER = process.env.AOK_LIVES_TELEGRAM ?? 'D:\\6_Societe\\Pilotage\\Academie\\catalogue\\outils\\lives_telegram.py'
const ARMER_PS1 = process.env.AOK_LIVES_ARMER ?? 'D:\\6_Societe\\Pilotage\\Academie\\catalogue\\outils\\armer_passage_lives.ps1'
const PYTHON = process.env.AOK_PYTHON ?? 'python.exe'
const CRED = process.env.AOK_CREDENTIALS ?? '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local'
const MINUTE = 60_000
const JOUR = 86_400_000

const versWindows = (p) => p.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\')
const versWsl = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/')

mkdirSync(DOSSIER, { recursive: true })

// ---------------------------------------------------------------------------------------------- journal et etat
function log(...morceaux) {
  const ligne = `${new Date().toISOString()} ${SIM ? '[SIMULATION] ' : ''}${morceaux.join(' ')}`
  console.log(ligne)
  try { appendFileSync(`${DOSSIER}/lives-programme.log`, ligne + '\n') } catch { /* le journal ne casse jamais un passage */ }
}

const CHEMIN_ETAT = `${DOSSIER}/etat.json`
const etat = existsSync(CHEMIN_ETAT) ? JSON.parse(readFileSync(CHEMIN_ETAT, 'utf8')) : {}
etat.programme ??= {}
etat.alertes ??= {}
const sauverEtat = () => writeFileSync(CHEMIN_ETAT, JSON.stringify({ ...etat, maj_le: new Date().toISOString() }, null, 1))

// ---------------------------------------------------------------------------------------------- base
const prisma = new PrismaClient()
const lire = (sql, ...v) => prisma.$queryRawUnsafe(sql, ...v)
async function ecrire(sql, ...v) {
  if (SIM) throw new Error('ecriture demandee en simulation (bug)')
  return prisma.$queryRawUnsafe(sql, ...v)
}
const colonneAbsente = (e) => /42703|column .* does not exist/i.test(e instanceof Error ? e.message : String(e))

/** Les lives de [du, au[ (aok_lives_entre), ou ceux d'un fichier (--lives-de, simulation). */
async function lireLives(du, au) {
  if (opt('lives-de')) {
    const f = JSON.parse(readFileSync(versWsl(opt('lives-de')), 'utf8'))
    return (f.lives ?? f).filter(l => Date.parse(l.debut) < au && Date.parse(l.debut) + (l.horaire_a_definir ? JOUR : l.duree_min * MINUTE) > du)
  }
  return lire(L.SQL_ENTRE, new Date(du), new Date(au))
}

// ---------------------------------------------------------------------------------------------- Telegram (lecture seule)
function telegram(...a) {
  const r = spawnSync(PYTHON, [HELPER, ...a], { cwd: '/mnt/d', encoding: 'utf8', timeout: 240_000, maxBuffer: 50 * 1024 * 1024 })
  if (r.error) throw new Error(`Telegram : ${r.error.message}`)
  const derniere = (r.stdout ?? '').trim().split('\n').pop() ?? ''
  let j
  try { j = JSON.parse(derniere) } catch { throw new Error(`Telegram : reponse illisible (code ${r.status})`) }
  if (!j.ok) throw new Error(`Telegram : ${j.erreur ?? 'erreur'}`)
  return j
}

const messagesEntre = (sujets, du, au) =>
  telegram('messages', '--sujets', sujets, '--depuis', new Date(du).toISOString(), '--jusqua', new Date(au).toISOString()).messages

// ---------------------------------------------------------------------------------------------- secrets (jamais affiches)
function secret(env, fichier, champ) {
  if (process.env[env]?.trim()) return process.env[env].trim()
  try { return JSON.parse(readFileSync(`${CRED}/${fichier}`, 'utf8'))[champ]?.trim() || null } catch { return null }
}

// ---------------------------------------------------------------------------------------------- alertes
async function alerter(cle, titre, lignes) {
  if (!lignes.length) return
  if (etat.alertes[cle]) { log(`alerte deja envoyee (${cle}) : pas de doublon`); return }
  const texte = P.texteAlerte(titre, lignes)
  if (SIM) {
    log(`ALERTE (simulation, NON envoyee) :\n${texte}`)
    etat.alertes[cle] = new Date(MAINTENANT).toISOString()
    return
  }
  const jeton = secret('TELEGRAM_BOT_TOKEN_COCKPIT', 'telegram-cockpit.local.json', 'bot_token')
  if (!jeton) { log('alerte impossible : jeton du bot du cockpit absent'); return }
  const equipe = await lire(P.SQL_EQUIPE)
  let livres = 0
  for (const { telegram_id } of equipe) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${jeton}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: Number(telegram_id), text: texte, link_preview_options: { is_disabled: true } }),
      })
      if ((await r.json()).ok) livres++
    } catch { /* un destinataire rate n'arrete pas les autres */ }
  }
  log(`alerte « ${titre} » : ${livres}/${equipe.length} destinataire(s)`)
  if (livres) etat.alertes[cle] = new Date().toISOString()
}

// ---------------------------------------------------------------------------------------------- Claude (vision)
async function lireImage(cheminImage) {
  const cle = secret('ANTHROPIC_API_KEY_AOK', 'anthropic-aok.local.json', 'api_key')
  if (!cle) throw new Error("cle Claude absente (ANTHROPIC_API_KEY_AOK ou credentials.local\\anthropic-aok.local.json) : aucune autre cle n'est essayee")
  const octets = readFileSync(versWsl(cheminImage))
  const type = octets[0] === 0x89 ? 'image/png' : octets[0] === 0x52 ? 'image/webp' : 'image/jpeg'
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: cle })
  // Repli serveur sur refus (« default »), comme le recommande la doc pour claude-opus-5-5.
  const rep = await client.beta.messages.create({
    ...P.requeteModele(octets.toString('base64'), type), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
  })
  log(`lecture de l'image : ${rep.model}, ${rep.usage?.input_tokens ?? '?'} jetons lus, ${rep.usage?.output_tokens ?? '?'} ecrits, fin : ${rep.stop_reason}`)
  if (rep.stop_reason === 'refusal') throw new Error('le modele a refuse de lire l image')
  if (rep.stop_reason === 'max_tokens') throw new Error('reponse coupee (max_tokens)')
  const texte = rep.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return JSON.parse(texte)
}

const estSuspect = (t) => analyserTexte(t, { niveau: 'injection' }).suspect

// ---------------------------------------------------------------------------------------------- 1. le programme
/** Le lundi de la semaine a lire maintenant : le dimanche, celle qui vient ; sinon, la semaine en cours. */
function semaineCible(t) {
  const jour = P.jourParis(t)
  const n = ((new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
  const d = new Date(Date.parse(`${jour}T12:00:00Z`) + (n === 7 ? 1 : 1 - n) * JOUR)
  return d.toISOString().slice(0, 10)
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n)

async function programme({ alerteSiAbsent = false } = {}) {
  const forcee = opt('semaine')
  const cible = forcee ?? semaineCible(MAINTENANT)
  const vendredi = P.parisVersIso(new Date(Date.parse(`${cible}T12:00:00Z`) - 3 * JOUR).toISOString().slice(0, 10), '00:00')
  const r = telegram('programme', '--depuis', opt('message') ? '2020-01-01T00:00:00Z' : vendredi,
    '--auteurs', Object.keys(P.ADMINS).join(','), '--sortie', versWindows(`${RACINE}/images`), ...(opt('message') ? ['--message', opt('message')] : []))
  if (!r.message) {
    log(`programme : aucune image de programme dans Annonce depuis le ${P.quandCourt(vendredi)}`)
    if (alerteSiAbsent) await alerter(`programme|${cible}|absent`, 'pas de programme de la semaine', [`Aucune image de programme postée dans Annonce depuis vendredi (semaine du ${cible.slice(8, 10)}/${cible.slice(5, 7)}). Les lives se posent à la main dans le cockpit.`])
    return null
  }
  const semaine = forcee ?? P.semaineDuProgramme(r.message.le)
  log(`programme : image du message ${r.message.id} (postee le ${P.quandCourt(r.message.le)} par ${P.ADMINS[r.message.auteur] ?? '?'}), semaine du ${semaine}`)

  // La reponse du modele : un fichier donne, le cache de cette image, ou un appel.
  const cache = `${RACINE}/reponses/programme-${r.message.id}.json`
  let brut
  if (opt('reponse')) { brut = JSON.parse(readFileSync(versWsl(opt('reponse')), 'utf8')); log(`reponse lue dans ${opt('reponse')} (aucun appel)`) }
  else if (existsSync(cache)) { brut = JSON.parse(readFileSync(cache, 'utf8')); log('reponse deja obtenue pour cette image (cache) : aucun nouvel appel') }
  else {
    try {
      brut = await lireImage(r.image)
    } catch (e) {
      log(`programme : lecture impossible : ${e.message}`)
      await alerter(`programme|${semaine}|${r.message.id}|lecture`, 'programme illisible', [`L'image du programme (message ${r.message.id}) n'a pas pu être lue : ${e.message}. Les lives se posent à la main.`])
      return null
    }
    mkdirSync(`${RACINE}/reponses`, { recursive: true })
    writeFileSync(cache, JSON.stringify(brut, null, 1))
  }

  const lu = P.lireReponseModele(brut, estSuspect)
  if (!lu.ok) {
    log(`programme : reponse rejetee (${lu.raison})`)
    await alerter(`programme|${semaine}|${r.message.id}|schema`, 'programme illisible', [`La lecture de l'image (message ${r.message.id}) est hors du format attendu (${lu.raison}) : rien n'est écrit.`])
    return null
  }
  const { lives, doutes } = P.livesDuProgramme(lu.programme, semaine, r.message.id)
  doutes.unshift(...lu.doutes)
  if (lu.programme.remarques.length) log(`remarques de la lecture : ${lu.programme.remarques.join(' | ')}`)

  // Ce qui est deja en base : les lignes du programme de cette semaine, et le calendrier de la semaine.
  let lignesProgramme = []
  try { lignesProgramme = await lire(P.SQL_PROGRAMME_SEMAINE, semaine) } catch (e) {
    if (!colonneAbsente(e)) throw e
    log('migration 20261115120000 pas encore appliquee : aucune ligne du programme en base (lu comme vide)')
  }
  const idsProgramme = new Set(lignesProgramme.map(x => x.id))
  const debutSemaine = Date.parse(P.parisVersIso(semaine, '00:00'))
  const calendrier = opt('lives-de') ? [] : await lire(L.SQL_ENTRE, new Date(debutSemaine), new Date(debutSemaine + 7 * JOUR))
  const existants = [
    ...lignesProgramme.map(x => ({ ...x, cle: `p:${x.id}`, debut: new Date(x.debut).toISOString() })),
    ...calendrier.filter(x => !idsProgramme.has(x.live_id)).map(x => ({
      id: x.live_id, cle: x.cle, programme_cle: null, cree_par: x.cree_par ?? null, modifie_par: x.modifie_par ?? null,
      titre: x.titre, animateur: x.animateur, debut: new Date(x.debut).toISOString(), statut: x.statut,
    })),
  ]
  const plan = P.planProgramme(lives, existants)
  for (const d of plan.disparus) doutes.push({ cle: d.cle, raison: `« ${d.titre} » (${d.cle.split('|').slice(1, 3).join(' ')}) n'est plus sur l'image : rien n'est retiré` })

  // Ce qu'on ecrirait.
  const action = (cle) => plan.a_creer.some(x => x.cle === cle) ? 'creer' : plan.a_mettre_a_jour.some(x => x.cle === cle) ? 'mettre a jour'
    : plan.identiques.includes(cle) ? 'deja en base' : plan.proteges.some(x => x.cle === cle) ? 'protege (a la main)'
      : plan.deja_au_calendrier.some(x => x.cle === cle) ? 'deja au calendrier' : '?'
  log(`programme de la semaine du ${semaine} : ${lives.length} live(s) lu(s)`)
  console.log(`  ${pad('jour', 16)} ${pad('heure', 7)} ${pad('intervenants', 14)} ${pad('type', 16)} ${pad('titre', 34)} ${pad('mentions', 20)} action`)
  for (const l of lives) {
    const mentions = [l.a_confirmer ? 'a confirmer' : '', l.horaire_a_definir ? 'horaire a definir' : ''].filter(Boolean).join(', ')
    console.log(`  ${pad(P.quandCourt(l.debut).slice(0, 10), 16)} ${pad(l.horaire_a_definir ? '--:--' : P.heureParis(l.debut), 7)} ${pad(l.animateur, 14)} ${pad(l.type_live ?? '', 16)} ${pad(l.titre, 34)} ${pad(mentions, 20)} ${action(l.cle)}`)
  }
  for (const x of plan.deja_au_calendrier) log(`  deja au calendrier : ${x.cle} (avec ${x.avec})`)

  if (!SIM) {
    let crees = 0
    let majs = 0
    for (const l of plan.a_creer) crees += (await ecrire(P.SQL_PROGRAMME_CREER, ...P.valeursProgramme(l))).length
    for (const l of plan.a_mettre_a_jour) majs += (await ecrire(P.SQL_PROGRAMME_MAJ, ...P.valeursProgramme(l))).length
    log(`programme ecrit : ${crees} cree(s), ${majs} mis a jour, ${plan.identiques.length} deja en base, ${plan.proteges.length} protege(s)`)
  } else log(`simulation : ${plan.a_creer.length} a creer, ${plan.a_mettre_a_jour.length} a mettre a jour, rien n'est ecrit`)

  if (doutes.length) await alerter(`programme|${semaine}|${r.message.id}|doutes`, `programme de la semaine du ${semaine.slice(8, 10)}/${semaine.slice(5, 7)}`, doutes.map(d => d.raison))
  etat.programme[semaine] = { message: r.message.id, lu_le: new Date(MAINTENANT).toISOString(), lives: lives.length }

  // Les lives tels que la tache les verra (fichier de simulation pour « rejouer » et « fenetres »).
  const commeEnBase = lives.map(l => ({
    cle: `p:${l.cle}`, serie_id: null, live_id: `simulation-${l.cle}`, titre: l.titre, animateur: l.animateur, debut: l.debut, duree_min: l.duree_min,
    statut: 'prevu', lien: null, replay: null, horaire_a_definir: l.horaire_a_definir, a_confirmer: l.a_confirmer, type_live: l.type_live, cree_par: P.SOURCE, modifie_par: P.SOURCE,
  }))
  const fichier = `${DOSSIER}/programme-${semaine}.json`
  writeFileSync(fichier, JSON.stringify({ semaine, message: r.message.id, image: r.image, lives: commeEnBase, doutes, plan }, null, 1))
  log(`lives de la semaine ecrits dans ${versWindows(fichier)}`)
  // En simulation d'une semaine passee, les passages se montrent depuis la veille de la semaine.
  montrerFenetres(commeEnBase, SIM && !opt('maintenant') ? Math.min(MAINTENANT, debutSemaine - JOUR) : MAINTENANT)
  return { semaine, lives: commeEnBase }
}

// ---------------------------------------------------------------------------------------------- 2 et 3. les passages
/** Un passage a l'instant t : liens des fenetres ouvertes, replays dus. Rend ce qui a ete pose (applique en memoire). */
async function passage(lives, t, sources = {}) {
  const du = P.aFaire(lives, t)
  const bilan = { liens: [], replays: [], doutes: [] }
  if (du.liens.length) {
    const depuis = Math.min(...du.liens.map(l => Date.parse(new Date(l.debut).toISOString()))) - 90 * MINUTE
    const messages = sources.messages ?? messagesEntre('annonce', depuis, t + MINUTE)
    const r = P.rapprocherLiens(du.liens, messages, t)
    for (const p of r.poses) {
      if (!SIM) {
        const ok = (await ecrire(P.SQL_LIEN_TACHE, p.live_id, p.lien)).length
        log(`lien ${ok ? 'pose' : 'NON pose (deja un lien, ou garde de la base)'} : ${p.cle} (message ${p.message} de ${p.auteur})`)
      } else log(`lien trouve : ${p.cle} (message ${p.message} de ${p.auteur}, ${new URL(p.lien).hostname}) : serait pose`)
      const l = lives.find(x => x.cle === p.cle)
      if (l) l.lien = p.lien
      bilan.liens.push(p)
    }
    for (const d of r.doutes) await alerter(`lien|${d.cle ?? ''}|${d.raison}`, 'un lien de live à vérifier', [d.raison])
    bilan.doutes.push(...r.doutes)
    for (const l of du.liensDerniers) {
      if (l.lien || r.poses.some(p => p.cle === l.cle) || r.doutes.some(d => d.cle === l.cle)) continue
      const raison = `${l.titre} avec ${l.animateur ?? '?'} (${P.quandCourt(new Date(l.debut).toISOString())}) : aucun lien posté dans Annonce à l'heure du début`
      bilan.doutes.push({ cle: l.cle, raison })
      await alerter(`lien|${l.cle}|absent`, 'pas de lien pour un live', [raison])
    }
  }
  if (du.replays.length) {
    const jours = du.replays.map(l => P.jourParis(l.debut)).sort()
    const lecons = sources.lecons ?? await lire(P.SQL_LECONS_REPLAY, jours[0], jours[jours.length - 1])
    let pris = new Set()
    if (!sources.messagesReplay) {
      try { pris = new Set((await lire(P.SQL_REPLAYS_PRIS)).map(x => x.replay)) } catch (e) { if (!colonneAbsente(e)) throw e }
    }
    for (const l of lives) if (l.replay) pris.add(l.replay)
    const depuis = Math.min(...du.replays.map(l => Date.parse(new Date(l.debut).toISOString())))
    const messages = sources.messagesReplay ?? messagesEntre('replay,annonce', depuis, t + MINUTE)
    const r = P.rapprocherReplays(du.replays, lecons, messages, t, pris)
    for (const p of r.poses) {
      if (!SIM) {
        const ok = (await ecrire(P.SQL_REPLAY_TACHE, p.live_id, p.replay)).length
        log(`replay ${ok ? 'pose' : 'NON pose (deja un replay, ou garde de la base)'} : ${p.cle} (${p.source})`)
      } else log(`replay trouve : ${p.cle} -> ${p.replay.startsWith('/') ? p.replay : new URL(p.replay).hostname} (${p.source}) : serait pose`)
      const l = lives.find(x => x.cle === p.cle)
      if (l) l.replay = p.replay
      bilan.replays.push(p)
    }
    for (const d of r.doutes) await alerter(`replay|${d.cle ?? ''}|${d.raison}`, 'un replay à vérifier', [d.raison])
    bilan.doutes.push(...r.doutes)
    for (const a of r.attentes) {
      const l = du.replays.find(x => x.cle === a.cle)
      const dernier = du.replaysDerniers.some(x => x.cle === a.cle)
      const quoi = a.raison === 'brouillon' ? 'la leçon de replay est encore en brouillon' : 'aucun replay trouvé'
      log(`replay en attente : ${a.cle} (${quoi})${dernier ? ' : dernier passage' : ''}`)
      if (dernier) {
        const raison = `${l.titre} avec ${l.animateur ?? '?'} (${P.quandCourt(new Date(l.debut).toISOString())}) : ${quoi}. Le coller dans le cockpit si besoin.`
        bilan.doutes.push({ cle: a.cle, raison })
        await alerter(`replay|${a.cle}|${a.raison}`, 'un replay manque', [raison])
      }
    }
  }
  return bilan
}

function montrerFenetres(lives, depuis) {
  const passages = P.passagesDe(lives).filter(p => Date.parse(p.quand) >= depuis - MINUTE)
  const parLive = new Map()
  for (const p of passages) {
    const k = `${p.cle}|${p.genre}`
    if (!parLive.has(k)) parLive.set(k, [])
    parLive.get(k).push(p)
  }
  console.log(`\n  Passages prevus (${passages.length}, heure de Paris) :`)
  for (const liste of parLive.values()) {
    const p = liste[0]
    const quand = p.genre === 'lien'
      ? `${P.quandCourt(liste[0].quand)} a ${P.heureParis(liste[liste.length - 1].quand)}, toutes les ${P.LIEN_PAS_MIN} min (${liste.length} passages)`
      : liste.map(x => P.quandCourt(x.quand)).join(' et ')
    console.log(`  ${pad(p.genre, 6)} ${pad(`${p.titre} (${p.animateur ?? '?'}, ${P.quandCourt(p.debut)})`, 58)} ${quand}`)
  }
  const sans = lives.filter(l => l.horaire_a_definir)
  for (const l of sans) console.log(`  aucun passage du lien : ${l.titre} (${l.animateur}) le ${P.quandCourt(l.debut).slice(0, 10)}, horaire a definir`)
  const prochain = P.prochainPassage(lives, depuis - 2 * MINUTE)
  console.log(`  Prochain reveil : ${prochain ? `${P.quandCourt(prochain.quand)} (${prochain.genre}, ${prochain.titre})` : 'aucun'}\n`)
}

function armer(lives, t) {
  const p = P.prochainPassage(lives, t)
  const quand = p ? `${P.jourParis(p.quand)} ${P.heureParis(p.quand)}` : ''
  if (!ARMER) { log(`prochain passage : ${quand || 'aucun'} (tache NON armee${SIM ? ', simulation' : ''})`); return }
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ARMER_PS1, '-Quand', quand], { encoding: 'utf8', timeout: 60_000 })
  log(`tache AOK-Lives armee pour ${quand || 'les seuls reveils fixes'} (code ${r.status})${r.status ? ` : ${(r.stderr ?? '').trim().slice(0, 200)}` : ''}`)
}

// ---------------------------------------------------------------------------------------------- commandes
async function tourner() {
  const verrou = `${DOSSIER}/.lives.lock`
  if (existsSync(verrou) && Date.now() - statSync(verrou).mtimeMs < 20 * MINUTE) { log('un passage tourne deja (verrou) : rien a faire'); return }
  closeSync(openSync(verrou, 'w'))
  try {
    log(`=== passage (${P.quandCourt(new Date(MAINTENANT).toISOString())})`)
    const cible = semaineCible(MAINTENANT)
    const jour = P.jourParis(MAINTENANT)
    const dimanche = new Date(`${jour}T12:00:00Z`).getUTCDay() === 0
    if (!etat.programme[cible] && (!dimanche || P.heureParis(MAINTENANT) >= '18:00')) {
      await programme({ alerteSiAbsent: !dimanche && P.heureParis(MAINTENANT) >= '07:00' }).catch(e => log(`programme : ${e.message}`))
    }
    const lives = await lireLives(MAINTENANT - 3 * JOUR, MAINTENANT + 8 * JOUR)
    const b = await passage(lives, MAINTENANT)
    log(`passage fait : ${b.liens.length} lien(s), ${b.replays.length} replay(s), ${b.doutes.length} doute(s)`)
    armer(lives, MAINTENANT)
  } finally {
    sauverEtat()
    try { unlinkSync(verrou) } catch { /* deja retire */ }
  }
}

/** Simulation d'une semaine entiere : chaque passage prevu, a son heure, avec les vrais messages et les vraies lecons. */
async function rejouer() {
  if (!opt('lives-de')) throw new Error('rejouer : --lives-de <programme-AAAA-MM-JJ.json> (sortie de « programme --simulation »)')
  const lives = await lireLives(0, 8.64e15)
  if (!lives.length) throw new Error('aucun live dans le fichier')
  etat.alertes = {}
  const debuts = lives.map(l => Date.parse(l.debut))
  const premier = Math.min(...debuts) - 2 * 60 * MINUTE
  const fin = Math.max(...debuts) + 2 * JOUR
  log(`rejouer : ${lives.length} lives, du ${P.quandCourt(new Date(premier).toISOString())} au ${P.quandCourt(new Date(fin).toISOString())}`)
  const tous = messagesEntre('annonce,replay', premier, fin)
  const annonce = tous.filter(m => m.sujet === 'annonce')
  const jours = lives.map(l => P.jourParis(l.debut)).sort()
  const lecons = await lire(P.SQL_LECONS_REPLAY, jours[0], jours[jours.length - 1])
  log(`rejouer : ${tous.length} messages lus (Annonce et Replay), ${lecons.length} lecons de replay sur ces jours (etat d'aujourd'hui)`)
  let t = premier
  let n = 0
  for (;;) {
    const p = P.prochainPassage(lives, t)
    if (!p || Date.parse(p.quand) > fin) break
    t = Date.parse(p.quand)
    n++
    const b = await passage(lives, t, { messages: annonce, messagesReplay: tous, lecons })
    if (b.liens.length || b.replays.length || b.doutes.length) {
      console.log(`  -> ${P.quandCourt(new Date(t).toISOString())} : ${b.liens.length} lien(s), ${b.replays.length} replay(s), ${b.doutes.length} doute(s)`)
    }
  }
  log(`rejouer : ${n} passages`)
  console.log('\n  Bilan par live :')
  for (const l of lives.sort((a, b) => Date.parse(a.debut) - Date.parse(b.debut))) {
    console.log(`  ${pad(P.quandCourt(l.debut), 16)} ${pad(l.animateur, 14)} ${pad(l.titre, 30)} lien : ${pad(l.lien ? new URL(l.lien).hostname : (l.horaire_a_definir ? 'sans heure' : 'aucun'), 18)} replay : ${l.replay ? (l.replay.startsWith('/') ? l.replay : new URL(l.replay).hostname) : 'aucun'}`)
  }
}

try {
  switch (COMMANDE) {
    case 'tourner': await tourner(); break
    case 'programme': await programme({ alerteSiAbsent: false }); sauverEtat(); break
    case 'passage': {
      const lives = await lireLives(MAINTENANT - 3 * JOUR, MAINTENANT + 8 * JOUR)
      const b = await passage(lives, MAINTENANT)
      log(`passage : ${b.liens.length} lien(s), ${b.replays.length} replay(s), ${b.doutes.length} doute(s)`)
      armer(lives, MAINTENANT)
      sauverEtat()
      break
    }
    case 'fenetres': montrerFenetres(await lireLives(MAINTENANT - JOUR, MAINTENANT + 8 * JOUR), MAINTENANT); break
    case 'rejouer': await rejouer(); break
    default:
      console.log('Commandes : tourner [--armer], programme, passage, fenetres, rejouer (voir l en-tete du fichier).')
      process.exitCode = 2
  }
} catch (e) {
  log(`ARRET : ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
