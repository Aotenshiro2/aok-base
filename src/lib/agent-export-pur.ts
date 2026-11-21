// L'EXPORT D'UNE LISTE PAR AGENT AOK (21/11/2026), partie pure : le CSV, son
// nom, et ce que le modele recoit en retour. Aucune base, aucun reseau.
//
// Pourquoi : Melanie a demande « le contact de tous les membres qui ont
// resilie un abonnement depuis le debut du Live Club ». La base en compte 145 ;
// requete_sql coupe son resultat a 14 000 caracteres (une ligne nom + email +
// Telegram pese environ 240 caracteres), l'agent en a rendu 58 et les a
// presentes comme la liste entiere. Une liste a remettre a un humain part
// donc en FICHIER, envoye par le serveur au demandeur ; le modele ne voit que
// le nombre de lignes, les colonnes et trois lignes d'apercu.

/** Les lignes lues au plus pour un export (la requete est bornee a PLAFOND_EXPORT + 1 pour savoir s'il y en a plus). */
export const PLAFOND_EXPORT = 5000
/** Les lignes d'apercu rendues au modele. */
export const APERCU_EXPORT = 3
/** Un fichier par reponse au plus : une demande, une liste. */
export const MAX_FICHIERS_PAR_REPONSE = 2

/** `tronque` : la requete avait plus de PLAFOND_EXPORT lignes, le fichier s'arrete au plafond. */
export type FichierExport = { nom: string; csv: string; lignes: number; tronque: boolean }

const SEPARATEUR = ';'
const BOM = '﻿'

/**
 * Le nom du fichier, fabrique par le serveur : « liste-<titre>-AAAA-MM-JJ.csv ».
 * Le titre du modele n'en donne que des lettres et des chiffres sans accent
 * (ni chemin, ni adresse, ni lien), 40 au plus. Date du jour a Paris.
 */
export function nomFichierExport(titre: unknown, maintenant: Date = new Date()): string {
  const brut = typeof titre === 'string' ? titre : ''
  const mot = brut.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
  const jour = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(maintenant)
  return `liste-${mot || 'export'}-${jour}.csv`
}

/** Une valeur lue en base, en texte de cellule (avant echappement). */
export function texteCellule(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'bigint') return v.toString()
  // Excel en francais : virgule decimale (le separateur est le point-virgule).
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : ''
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/ 00:00:00$/, '')
  // Decimal de Prisma (toString), tableaux et JSON.
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { toFixed?: unknown }).toFixed === 'function') {
    return String(v).replace('.', ',')
  }
  try { return JSON.stringify(v) } catch { return String(v) }
}

/**
 * Une cellule CSV : entre guillemets si elle porte le separateur, un guillemet
 * ou un retour a la ligne. Un TEXTE qui commence par = + - @ (ou tabulation,
 * retour chariot) prend une apostrophe devant : un nom de membre ne devient
 * jamais une formule dans Excel. Les nombres ne sont pas touches.
 */
export function celluleCsv(v: unknown): string {
  let t = texteCellule(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** Les colonnes : celles de la premiere ligne, puis celles qui n'apparaissent qu'ensuite, dans l'ordre. */
export function colonnesDe(lignes: readonly Record<string, unknown>[]): string[] {
  const vues = new Set<string>()
  for (const l of lignes) for (const k of Object.keys(l)) vues.add(k)
  return [...vues]
}

/** Le fichier : BOM UTF-8 (Excel lit les accents), point-virgule, fins de ligne CRLF, une ligne d'en-tete. */
export function csvDeLignes(lignes: readonly Record<string, unknown>[]): { csv: string; colonnes: string[] } {
  const colonnes = colonnesDe(lignes)
  const sortie = [colonnes.map(celluleCsv).join(SEPARATEUR)]
  for (const l of lignes) sortie.push(colonnes.map(c => celluleCsv(l[c])).join(SEPARATEUR))
  return { csv: `${BOM}${sortie.join('\r\n')}\r\n`, colonnes }
}

/** Une valeur pour le JSON de l'apercu (bigint en nombre, comme requete_sql). */
function pourJson(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? Number(v) : v
}

/**
 * Ce que le modele recoit : le nombre de lignes, les colonnes, trois lignes
 * d'apercu, et ce qui est fait du fichier. Jamais la liste entiere.
 */
export function resumeExportPourModele(o: {
  lignes: readonly Record<string, unknown>[]; colonnes: string[]; tronque: boolean; nom: string
}): string {
  return JSON.stringify({
    fichier: o.nom,
    lignes: o.lignes.length,
    colonnes: o.colonnes,
    apercu: o.lignes.slice(0, APERCU_EXPORT),
    remis: "Le serveur envoie le fichier à ton interlocuteur dans son fil Agent AOK, juste après ta réponse. Ne recopie pas la liste : dis combien de lignes il contient et ce qu'il contient.",
    ...(o.tronque ? { plafond: `Plus de ${PLAFOND_EXPORT} lignes : le fichier s'arrête à ${PLAFOND_EXPORT}. Dis-le, et propose de découper la demande (par période, par statut).` } : {}),
  }, pourJson)
}

/** Le texte qui accompagne le fichier dans Telegram (legende). */
export function legendeExport(f: Pick<FichierExport, 'lignes' | 'tronque'>): string {
  const n = f.lignes
  return `${n} ligne${n > 1 ? 's' : ''}${f.tronque ?` (plafond de ${PLAFOND_EXPORT} atteint)` : ''}. Fichier CSV, s'ouvre dans Excel.`
}

/** (21/11) Les mots ajoutes a un resultat de requete_sql coupe : le modele ne doit jamais le prendre pour la liste entiere. */
export function noteResultatTronque(o: { lignes: number; coupe: boolean }): string {
  const debut = o.coupe ? `[résultat tronqué : ${o.lignes} lignes lues, coupées à l'affichage` : `[résultat tronqué : plafond de ${o.lignes} lignes atteint`
  return `${debut}. Ce morceau n'est PAS la liste complète : compte le vrai total (count) et annonce-le ; pour une liste à remettre, passe par l'export en fichier.]`
}
