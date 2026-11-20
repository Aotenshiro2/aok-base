// Faux module '@/lib/db' pour scripts/verifier-rapprochement-liste.mjs : la
// transaction appelle la fonction avec la fausse transaction posee par le test
// (globalThis.__fauxTx). Aucune base, aucun reseau.
export const prisma = {
  $transaction: async (f) => f(globalThis.__fauxTx),
  $disconnect: async () => {},
}
