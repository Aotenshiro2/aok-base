// L'historique des noms Telegram, cote journal (passe 1 du chantier « noms et
// paroles des membres », Brice 15/10/2026). Regles dans noms-pur.ts.
//
// BEST EFFORT, sans exception : noterNomTelegram ne leve jamais. Une base
// illisible, une migration pas encore appliquee (fonction absente) ou une
// ligne refusee ne bloquent ni le webhook du groupe ni le bot des membres :
// un avertissement dans les logs, sans nom ni identifiant, et c'est tout.
//
// On ECRIT seulement, on ne lit jamais : la table n'est lisible que par
// l'equipe du cockpit et l'agent (aucun outil d'un bot membre n'y touche).

import { prisma } from '@/lib/db'
import { jourParis } from './passage-regles'
import {
  identiteARelire, identiteTelegram, ligneNom, memoriserIdentite, nomANoter, type SourceNom, type UtilisateurTg,
} from './noms-pur'

// Compte Telegram -> derniere cle (jour de Paris, pseudo, nom) ecrite en prive,
// pour cette instance du serveur. La fonction SQL refait la garde en base.
const NOMS_PRIVES_DU_JOUR = new Map<number, string>()

// (17/11) Compte Telegram -> derniere identite (pseudo, nom) confrontee au
// registre du groupe, pour cette instance du serveur (rafraichirRegistre).
const IDENTITES_CONFRONTEES = new Map<number, string>()

/**
 * (17/11) Le registre du groupe (cockpit_telegram_membres) suit le pseudo et
 * le nom d'un compte DEJA connu, a chaque fois que le bot le voit (message du
 * groupe ou en prive, bouton, demande d'adhesion). Regles dans noms-pur.ts
 * (champsARafraichir : un pseudo ou un nom absent n'efface rien). N'insere
 * jamais : la presence reste l'affaire des chat_member. Une requete par compte
 * et par identite sur cette instance, au plus. Quand le registre change, la
 * nouvelle identite va aussi dans l'historique des noms (source donnee).
 * BEST EFFORT, ne leve jamais, aucun nom ni identifiant dans les logs.
 * Rend vrai si une ligne a change.
 */
export async function rafraichirRegistre(
  u: UtilisateurTg | null | undefined,
  source: SourceNom,
  quand: Date = new Date(),
): Promise<boolean> {
  try {
    const i = identiteTelegram(u)
    if (!i || (!i.pseudo && !i.nomAffiche)) return false
    if (!identiteARelire(IDENTITES_CONFRONTEES, i)) return false
    // Meme regle que champsARafraichir, en une requete : rien n'est ecrit si
    // le pseudo et le nom sont deja ceux-la (ou absents cote Telegram).
    const n = await prisma.$executeRaw`
      update public.cockpit_telegram_membres
      set pseudo = coalesce(${i.pseudo}::text, pseudo),
          nom_affiche = coalesce(${i.nomAffiche}::text, nom_affiche),
          maj_le = now()
      where telegram_id = ${i.telegramId}
        and ((${i.pseudo}::text is not null and pseudo is distinct from ${i.pseudo}::text)
          or (${i.nomAffiche}::text is not null and nom_affiche is distinct from ${i.nomAffiche}::text))`
    memoriserIdentite(IDENTITES_CONFRONTEES, i)
    if (n > 0) {
      console.log(`[liveclub/noms] registre du groupe : pseudo ou nom mis a jour (${source})`)
      // En prive, traiterMessagePrive note aussi le nom : la garde du jour
      // (nomANoter puis la fonction SQL) evite le doublon.
      await noterNomTelegram(u, source, quand)
      return true
    }
    return false
  } catch (err) {
    const texte = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ')
    const code = /Code: `?([0-9A-Z]{5})`?/.exec(texte)?.[1] ?? null
    console.warn(`[liveclub/noms] registre du groupe non rafraichi : ${code ? `code ${code}` : texte.slice(0, 120)}`)
    return false
  }
}

export async function noterNomTelegram(
  u: UtilisateurTg | null | undefined,
  source: SourceNom,
  quand: Date = new Date(),
): Promise<void> {
  try {
    const identite = identiteTelegram(u)
    if (!identite) return
    const vuLe = Number.isFinite(quand.getTime()) ? quand : new Date()
    const uneFoisParJour = source === 'prive'
    if (uneFoisParJour && !nomANoter(NOMS_PRIVES_DU_JOUR, identite, jourParis(vuLe.toISOString()))) return
    const lignes = JSON.stringify([ligneNom(identite, source, vuLe)])
    await prisma.$queryRaw`
      select public.cockpit_telegram_noms_noter(${lignes}::jsonb, ${uneFoisParJour})::text as r`
  } catch (err) {
    // Le code Postgres suffit (jamais la ligne refusee, qui porterait le nom).
    const texte = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ')
    const code = /Code: `?([0-9A-Z]{5})`?/.exec(texte)?.[1] ?? null
    if (code === '42883' || code === '42P01' || /does not exist/i.test(texte)) {
      console.warn(`[liveclub/noms] historique des noms absent (migration 20261015170000 pas appliquee ?) : nom ${source} non note.`)
    } else {
      console.warn(`[liveclub/noms] nom ${source} non note : ${code ? `code ${code}` : texte.slice(0, 120)}`)
    }
  }
}
