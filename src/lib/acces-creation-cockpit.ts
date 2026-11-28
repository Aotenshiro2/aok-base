import { prisma } from '@/lib/db'

// (28/11/2026) Qui peut utiliser les gestes d'IA de l'espace Creation du cockpit (/api/cockpit/creation,
// /api/cockpit/generation) : l'allowlist du cockpit ('equipe'), ET le niveau d'acces restreint
// (cockpit_niveaux, niveau 'animateur', chantier espace-adrien, lot 5) ('niveau').
// Pour 'niveau', les routes ajoutent leurs bornes : ses propres decoupages et brouillons seulement,
// et aucun cout dans la reponse (cout_micros). Aucune table d'argent n'est lue par ces routes.
//
// A n'utiliser QUE pour ces deux routes. Toute autre route du cockpit garde l'allowlist seule.
export type AccesCreation = 'equipe' | 'niveau' | null

export async function accesCreationCockpit(userId: string): Promise<AccesCreation> {
  const r = await prisma.$queryRaw<{ qui: string }[]>`
    select 'equipe' as qui from public.cockpit_allowlist where user_id = ${userId}::uuid
    union all
    select 'niveau' as qui from public.cockpit_niveaux where user_id = ${userId}::uuid and niveau = 'animateur'`
  if (r.some((l) => l.qui === 'equipe')) return 'equipe'
  if (r.some((l) => l.qui === 'niveau')) return 'niveau'
  return null
}

/** Le brouillon `id` a-t-il ete ecrit par `userId` ? (regenerer, retoucher, reprendre une capture) */
export async function brouillonDe(id: string, userId: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_generations where id = ${id}::uuid and cree_par = ${userId}::uuid`
  return r.length > 0
}
