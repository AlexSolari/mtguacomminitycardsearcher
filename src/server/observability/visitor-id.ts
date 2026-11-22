import { createHash, randomBytes } from 'node:crypto';

// Counts unique visitors without storing anything about them, the way cookieless analytics (Plausible) do: a
// visitor's id is a hash of their IP and User-Agent with a random salt that lives only in this process's memory and
// is replaced at midnight UTC. The same visitor keeps the same id all day, so the dashboard can count distinct ids
// per day. Ids from different days can't be linked, and since the salt is never written anywhere, an id can't be
// turned back into an IP either. The IP itself is never recorded (see "never log client IPs" in AGENTS.md).
// A restart picks a new salt, so on a day with a deploy, visitors from before and after it are counted twice.
export class VisitorIds {
    private day = '';
    private salt = '';

    constructor(
        private readonly now = () => new Date(),
        private readonly newSalt = () => randomBytes(32).toString('hex')
    ) {}

    // 16 hex characters; `ip` is clientId()'s answer
    id(ip: string, userAgent: string | null): string {
        const day = this.now().toISOString().slice(0, 10);
        if (day !== this.day) {
            this.day = day;
            this.salt = this.newSalt();
        }
        return createHash('sha256')
            .update(`${this.salt}\n${ip}\n${userAgent ?? ''}`)
            .digest('hex')
            .slice(0, 16);
    }
}
