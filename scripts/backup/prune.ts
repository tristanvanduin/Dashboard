// W1.5 (Z2): past de geteste retentie-policy toe op een lijst dumpbestandsnamen (een per
// regel op stdin, meestal de output van de bucket-listing) en print de te verwijderen
// bestanden. De IO (de daadwerkelijke delete) doet het shell-script; de beslissing staat
// in de geteste lib/backup/policy.ts.
import { readFileSync } from "fs";
import { selectBackupsToDelete, DEFAULT_RETENTION } from "../../lib/backup/policy";

const invoer = readFileSync(0, "utf8").split("\n").map((s: string) => s.trim()).filter(Boolean);
const { remove } = selectBackupsToDelete(invoer, DEFAULT_RETENTION);
for (const f of remove) console.log(f);
