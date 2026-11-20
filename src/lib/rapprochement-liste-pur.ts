// LE RAPPROCHEMENT D'UNE LISTE DE PERSONNES avec leurs comptes Telegram
// (21/11/2026, cas de Melanie : une capture d'environ 120 emails d'anciens
// membres du Live Club, « donne-moi leurs noms Telegram »). L'agent avait ecrit
// son SQL a la main sur une source (le pseudo declare au paiement), puis deux,
// rendu 56 personnes sur 67 a 72 joignables et ecrit « rien en base » pour
// des membres rattaches a un compte sans @pseudo.
//
// Regles PURES, sans base : lecture de l'entree, voie et niveau de confiance
// de chaque personne, candidats par le nom, decompte, reponse bornee. Le
// recoupement d'UNE personne reste celui de fiche_personne (resoudrePersonne,
// fiche-personne.ts) : rapprochement-liste.ts l'appelle pour chacune.
// Verifie par scripts/verifier-rapprochement-liste.mjs.

import type { Groupe, LienLu } from './fiche-personne-pur'

/** 300 personnes au plus par appel. */
export const MAX_LISTE = 300
/** Une entree de liste : un email ou un nom, 120 caracteres au plus (comme fiche_personne). */
export const MAX_ENTREE = 120
/** La reponse rendue au modele, en caracteres, au plus. */
export const BUDGET_LISTE = 30000

export const POPULATIONS = {
  desabonnes_live_club: "désabonnés du Live Club (ont eu un abonnement Live Club, plus aucun abonnement vivant)",
  membres_live_club: 'membres actuels du Live Club (au moins un abonnement Live Club vivant)',
} as const
export type Population = keyof typeof POPULATIONS

export type EntreeListe =
  | { genre: 'liste'; personnes: string[]; doublons: number }
  | { genre: 'population'; population: Population }

/** Les entrees : une liste (tableau, ou texte coupe aux retours, virgules et points-virgules), ou une population nommee. */
export function lireEntreeListe(entree: unknown): EntreeListe | { erreur: string } {
  const o = entree && typeof entree === 'object' ? entree as { personnes?: unknown; population?: unknown } : {}
  const pop = typeof o.population === 'string' ? o.population.trim() : ''
  if (pop) {
    if (!(pop in POPULATIONS)) return { erreur: `population inconnue : ${Object.keys(POPULATIONS).join(' ou ')}.` }
    return { genre: 'population', population: pop as Population }
  }
  const brutes = Array.isArray(o.personnes) ? o.personnes : typeof o.personnes === 'string' ? o.personnes.split(/[\n;,]+/) : null
  if (!brutes) return { erreur: 'personnes (une liste d\'emails ou de noms) ou population manquante.' }
  const vues = new Set<string>()
  const personnes: string[] = []
  let doublons = 0
  for (const b of brutes) {
    if (typeof b !== 'string') continue
    const t = b.replace(/\s+/g, ' ').trim()
    if (!t) continue
    const cle = t.toLowerCase()
    if (vues.has(cle)) { doublons++; continue }
    vues.add(cle)
    personnes.push(t)
  }
  if (personnes.length === 0) return { erreur: 'liste vide.' }
  if (personnes.length > MAX_LISTE) return { erreur: `${personnes.length} personnes : ${MAX_LISTE} au plus par appel, découpe la liste.` }
  return { genre: 'liste', personnes, doublons }
}

// ---------------------------------------------------------------------------
// Voie et confiance
// ---------------------------------------------------------------------------

export type Voie = 'rattachement' | 'registre' | 'support' | 'geste' | 'pont_archive' | 'pseudo_declare' | 'candidat_nom'
export type Confiance = 'lien_dur' | 'probable' | 'candidat_nom' | 'aucune_trace' | 'inconnu' | 'plusieurs' | 'illisible'

export const LIBELLE_CONFIANCE: Record<Confiance, string> = {
  lien_dur: 'lien dur',
  probable: 'probable (à confirmer)',
  candidat_nom: 'candidat par le nom (à confirmer)',
  aucune_trace: 'aucune trace Telegram',
  inconnu: 'personne introuvable en base',
  plusieurs: 'plusieurs personnes possibles',
  illisible: 'entrée illisible',
}

const ORDRE_VOIES: Voie[] = ['rattachement', 'geste', 'support', 'pont_archive', 'registre', 'pseudo_declare', 'candidat_nom']

/** La voie d'un lien certain qui touche un compte. */
export function voieDuLien(nature: string): Voie {
  if (/rattachement|compte Telegram remplacé/.test(nature)) return 'rattachement'
  if (/exemption|posé à la main/.test(nature)) return 'geste'
  if (/archive/.test(nature)) return 'pont_archive'
  if (/pseudo déclaré/.test(nature)) return 'pseudo_declare'
  return 'registre'
}

/** La voie d'une touche sur un compte (ce qui a repondu a la recherche). null = une touche par le nom seulement. */
export function voieDeLaTouche(champ: string): Voie | null {
  if (/rattachement/.test(champ)) return 'rattachement'
  if (/accès broker|tarif réservé/.test(champ)) return 'geste'
  if (/bot des membres/.test(champ)) return 'support'
  if (/numéro Telegram demandé/.test(champ)) return 'registre'
  return null
}

const meilleureVoie = (v: Voie[]): Voie | null => ORDRE_VOIES.find((x) => v.includes(x)) ?? null

/**
 * Les comptes Telegram d'un groupe (une personne de resoudrePersonne), avec
 * leur voie. Un compte relie a une fiche membre par un lien certain est un
 * lien dur ; un groupe SANS fiche n'est sur que si une touche exacte
 * l'identifie (email, numero) : sinon il n'a ete trouve que par le nom.
 */
export function comptesDuGroupe(g: Pick<Groupe, 'noeuds' | 'touches' | 'certains'>): { durs: { id: number; voie: Voie }[]; parNom: number[] } {
  const tgs = g.noeuds.filter((n) => n.startsWith('tg:'))
  const avecFiche = g.noeuds.some((n) => n.startsWith('membre:'))
  const durs: { id: number; voie: Voie }[] = []
  const parNom: number[] = []
  for (const n of tgs) {
    const id = Number(n.slice(3))
    if (!Number.isSafeInteger(id) || id <= 0) continue
    const voies: Voie[] = []
    for (const l of g.certains) if (l.a === n || l.b === n) voies.push(voieDuLien(l.nature))
    for (const t of g.touches) if (t.noeud === n) { const v = voieDeLaTouche(t.champ); if (v) voies.push(v) }
    const exacte = g.touches.some((t) => t.noeud === n && voieDeLaTouche(t.champ) !== null)
    if (avecFiche || exacte) durs.push({ id, voie: meilleureVoie(voies) ?? 'registre' })
    else parNom.push(id)
  }
  return { durs, parNom }
}

/** Les liens PROBABLES d'un groupe vers un compte ou une archive hors du groupe. */
export function probablesDuGroupe(g: Pick<Groupe, 'noeuds' | 'probables'>): { comptes: { id: number; voie: Voie }[]; archives: string[] } {
  const dedans = new Set(g.noeuds)
  const comptes: { id: number; voie: Voie }[] = []
  const archives: string[] = []
  for (const l of g.probables as LienLu[]) {
    const dehors = dedans.has(l.a) ? l.b : l.a
    if (dedans.has(dehors)) continue
    if (dehors.startsWith('tg:')) {
      const id = Number(dehors.slice(3))
      if (Number.isSafeInteger(id) && id > 0) comptes.push({ id, voie: voieDuLien(l.nature) })
    } else if (dehors.startsWith('archive:')) archives.push(dehors.slice(8))
  }
  return { comptes, archives }
}

// ---------------------------------------------------------------------------
// Candidats par le nom (prenom + nom dans un nom affiche Telegram)
// ---------------------------------------------------------------------------

export function sansAccent(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
export function mots(s: string | null | undefined): string[] {
  return sansAccent(s ?? '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length >= 3)
}
const squelette = (s: string) => s.replace(/[^a-z]/g, '').replace(/[aeiouy]/g, '')

export type NomAffiche = { id: number; mots: Set<string> }

/** Index des noms affiches connus (registre du groupe, noms Telegram passes), par compte. */
export function indexerNoms(lignes: { id: number; nom: string | null }[]): NomAffiche[] {
  const par = new Map<number, Set<string>>()
  for (const l of lignes) {
    if (!l.nom) continue
    const s = par.get(l.id) ?? new Set<string>()
    for (const m of mots(l.nom)) s.add(m)
    par.set(l.id, s)
  }
  return [...par.entries()].map(([id, m]) => ({ id, mots: m }))
}

/**
 * Les comptes dont un nom affiche porte le prenom ET le nom de la fiche
 * (« Boris Fauchart »), ou le prenom et un nom abrege de meme squelette
 * (« Boris Fchrt »). Jamais une preuve : un candidat a confirmer.
 */
export function candidatsParNom(prenom: string | null, nom: string | null, index: NomAffiche[]): number[] {
  const tp = mots(prenom)
  const tn = mots(nom).filter((t) => !tp.includes(t))
  if (!tp.length || !tn.length) return []
  const sn = tn.map(squelette).filter((x) => x.length >= 3)
  const r: number[] = []
  for (const c of index) {
    if (!tp.some((t) => c.mots.has(t))) continue
    if (tn.some((t) => c.mots.has(t))) { r.push(c.id); continue }
    const autres = [...c.mots].filter((t) => !tp.includes(t)).map(squelette).filter((x) => x.length >= 3)
    if (sn.some((s) => autres.some((o) => o === s || (o.length >= 4 && s.slice(0, 4) === o.slice(0, 4))))) r.push(c.id)
  }
  return r
}

// ---------------------------------------------------------------------------
// Une personne : ce qu'on sait d'elle, puis sa ligne
// ---------------------------------------------------------------------------

export type CompteLu = { id: number; pseudo: string | null; nom: string | null; present: boolean; registre: boolean }

export type FaitsPersonne = {
  /** Ce qu'on a donne (l'email ou le nom de la liste), ou null pour une population. */
  entree: string | null
  statut: 'un' | 'plusieurs' | 'aucun' | 'illisible'
  /** Nom de la fiche membre (prenom nom), ou null. */
  fiche: string | null
  durs: { id: number; voie: Voie }[]
  probables: { id: number; voie: Voie }[]
  pseudoDeclare: string | null
  candidats: number[]
  /** Nombre de personnes possibles (statut plusieurs). */
  nbPersonnes?: number
}

export type LignePersonne = {
  personne: string
  telegram: string | null
  dans_groupe: boolean | null
  voie: Voie | null
  confiance: Confiance
  candidats?: number
}

/** « @pseudo », sinon le nom affiche entre guillemets, sinon null. */
export function nomTelegram(c: CompteLu | undefined): string | null {
  if (!c) return null
  if (c.pseudo) return `@${c.pseudo.replace(/^@+/, '')}`
  if (c.nom) return `« ${c.nom} » (sans @pseudo)`
  return null
}

/** Le meilleur compte parmi plusieurs : present dans le groupe, puis avec @pseudo, puis avec un nom. */
export function meilleurCompte(ids: number[], comptes: Map<number, CompteLu>): CompteLu | undefined {
  const l = ids.map((id) => comptes.get(id)).filter((c): c is CompteLu => !!c)
  const score = (c: CompteLu) => (c.present ? 4 : 0) + (c.pseudo ? 2 : 0) + (c.nom ? 1 : 0)
  return l.sort((x, y) => score(y) - score(x) || x.id - y.id)[0]
}

export function lignePersonne(f: FaitsPersonne, comptes: Map<number, CompteLu>): LignePersonne {
  const personne = f.fiche ?? f.entree ?? '?'
  const base = { personne: f.entree && f.fiche ? `${f.entree} (${f.fiche})` : personne }
  if (f.statut === 'illisible') return { ...base, telegram: null, dans_groupe: null, voie: null, confiance: 'illisible' }
  if (f.statut === 'plusieurs') return { ...base, telegram: null, dans_groupe: null, voie: null, confiance: 'plusieurs', candidats: f.nbPersonnes }
  if (f.statut === 'aucun') return { ...base, telegram: null, dans_groupe: null, voie: null, confiance: 'inconnu' }
  const lier = (l: { id: number; voie: Voie }[], confiance: Confiance): LignePersonne => {
    const c = meilleurCompte(l.map((x) => x.id), comptes)
    const voie = (c && l.find((x) => x.id === c.id)?.voie) ?? meilleureVoie(l.map((x) => x.voie))
    return { ...base, telegram: nomTelegram(c) ?? (c ? `compte u${c.id} (nom inconnu)` : null), dans_groupe: c ? c.present : null, voie, confiance }
  }
  if (f.durs.length) return lier(f.durs, 'lien_dur')
  if (f.probables.length) return lier(f.probables, 'probable')
  if (f.pseudoDeclare) {
    return { ...base, telegram: `@${f.pseudoDeclare.replace(/^@+/, '')} (déclaré au paiement, compte non retrouvé)`, dans_groupe: null, voie: 'pseudo_declare', confiance: 'probable' }
  }
  if (f.candidats.length) {
    const c = meilleurCompte(f.candidats, comptes)
    return {
      ...base, telegram: nomTelegram(c), dans_groupe: c ? c.present : null, voie: 'candidat_nom', confiance: 'candidat_nom',
      ...(f.candidats.length > 1 ? { candidats: f.candidats.length } : {}),
    }
  }
  return { ...base, telegram: null, dans_groupe: null, voie: null, confiance: 'aucune_trace' }
}

// ---------------------------------------------------------------------------
// Decompte et reponse
// ---------------------------------------------------------------------------

export type Decompte = {
  total: number
  par_confiance: Partial<Record<Confiance, number>>
  par_voie: Partial<Record<Voie, number>>
  /** Parmi les liens durs et probables : rendus par @pseudo, par nom affiche seul. */
  avec_pseudo: number
  nom_affiche_seul: number
  dans_le_groupe: number
}

export function decompter(lignes: LignePersonne[]): Decompte {
  const d: Decompte = { total: lignes.length, par_confiance: {}, par_voie: {}, avec_pseudo: 0, nom_affiche_seul: 0, dans_le_groupe: 0 }
  for (const l of lignes) {
    d.par_confiance[l.confiance] = (d.par_confiance[l.confiance] ?? 0) + 1
    if (l.voie) d.par_voie[l.voie] = (d.par_voie[l.voie] ?? 0) + 1
    if (l.confiance === 'lien_dur' || l.confiance === 'probable') {
      if (l.telegram?.startsWith('@')) d.avec_pseudo++
      else if (l.telegram?.startsWith('«')) d.nom_affiche_seul++
    }
    if (l.dans_groupe === true) d.dans_le_groupe++
  }
  return d
}

/** Le decompte en une phrase, a citer telle quelle. */
export function phraseDecompte(d: Decompte): string {
  const c = (k: Confiance) => d.par_confiance[k] ?? 0
  const morceaux = [
    `${d.total} personnes`,
    `${c('lien_dur')} en lien dur`,
    `${c('probable')} probables à confirmer`,
    `${c('candidat_nom')} candidats par le nom à confirmer`,
    `${c('aucune_trace')} sans aucune trace Telegram`,
  ]
  if (c('inconnu')) morceaux.push(`${c('inconnu')} introuvables en base`)
  if (c('plusieurs')) morceaux.push(`${c('plusieurs')} avec plusieurs personnes possibles`)
  if (c('illisible')) morceaux.push(`${c('illisible')} entrées illisibles`)
  return `${morceaux.join(', ')}. Parmi les liens durs et probables : ${d.avec_pseudo} par @pseudo, ${d.nom_affiche_seul} par leur nom affiché (sans @).`
}

const RANG: Record<Confiance, number> = { lien_dur: 0, probable: 1, candidat_nom: 2, plusieurs: 3, aucune_trace: 4, inconnu: 5, illisible: 6 }

/**
 * La reponse au modele : le decompte calcule, puis une ligne par personne
 * (liens durs d'abord), bornee a `budget` caracteres. Si la liste ne tient
 * pas, les dernieres lignes sont coupees et le dit ; le decompte, lui, porte
 * toujours sur TOUTES les personnes.
 */
export function reponseListe(
  lignes: LignePersonne[], o: { quoi: string; nonTraites?: number; doublons?: number; budget?: number } ,
): { texte: string; lignesRendues: number } {
  const budget = o.budget ?? BUDGET_LISTE
  const d = decompter(lignes)
  const triees = [...lignes].sort((x, y) => RANG[x.confiance] - RANG[y.confiance])
  const tete = {
    statut: 'liste',
    quoi: o.quoi,
    decompte: d,
    phrase: phraseDecompte(d),
    ...(o.nonTraites ? { non_traites: o.nonTraites, note_temps: `${o.nonTraites} personnes non traitées faute de temps : relance l'outil avec elles seules. Le décompte ne porte que sur les ${lignes.length} traitées.` } : {}),
    ...(o.doublons ? { doublons_retires: o.doublons } : {}),
    regle: "Cite le décompte et la phrase tels quels. « probable » et « candidat par le nom » sont À CONFIRMER. « aucune trace Telegram » veut dire : rapprochement complet passé, rien trouvé.",
  }
  const lignesTexte = triees.map((l) => [
    l.personne, l.telegram ?? '-', l.dans_groupe === null ? '-' : l.dans_groupe ? 'dans le groupe' : 'hors du groupe',
    l.voie ?? '-', LIBELLE_CONFIANCE[l.confiance] + (l.candidats ? ` (${l.candidats})` : ''),
  ].join(' | '))
  const gardees: string[] = []
  let taille = JSON.stringify(tete).length + 200
  for (const t of lignesTexte) {
    if (taille + t.length + 4 > budget) break
    gardees.push(t)
    taille += t.length + 4
  }
  const coupees = lignesTexte.length - gardees.length
  const texte = JSON.stringify({
    ...tete,
    colonnes: 'personne | nom Telegram | groupe | voie | confiance',
    personnes: gardees,
    ...(coupees ? { lignes_coupees: `${coupees} lignes coupées (la borne) : les dernières du classement. Relance avec ces personnes seules pour les voir.` } : {}),
  })
  return { texte, lignesRendues: gardees.length }
}

