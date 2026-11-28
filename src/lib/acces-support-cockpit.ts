import { prisma } from '@/lib/db'

// (28/11/2026) Qui peut AGIR dans l'ecran Support du cockpit (repondre, rendre la main au bot, marquer
// traite, ouvrir une piece jointe) : l'allowlist du cockpit, ET le niveau d'acces restreint
// (cockpit_niveaux, niveau 'animateur', chantier espace-adrien). Ces gestes ne touchent que les fils
// du support : aucune table d'argent n'est lue ni rendue par ces routes.
//
// A n'utiliser QUE pour les routes du support. Toute autre route du cockpit garde l'allowlist seule.
export async function accesSupportCockpit(userId: string): Promise<boolean> {
  const r = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid
    union all
    select 1 as ok from public.cockpit_niveaux where user_id = ${userId}::uuid and niveau = 'animateur'
    limit 1`
  return r.length > 0
}
