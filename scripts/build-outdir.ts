import { existsSync } from 'fs';
import path from 'path';

// The project's own folders, which a build must never land in: the build deletes its outdir first.
const PROJECT_FOLDERS = [
    'src',
    'tests',
    'scripts',
    'node_modules',
    '.git',
    'data'
];

const isWithin = (dir: string, parent: string) => {
    const rel = path.relative(parent, dir);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Why deleting `outdir` (already resolved) would take more than a previous build with it, or null when it's safe:
// the project or a folder above it, the home folder, another project, or one of this project's own folders. Anywhere
// else is fair game: dist/ (the default), or a folder outside the project.
export function unsafeOutdir(
    outdir: string,
    root: string,
    home: string
): string | null {
    if (isWithin(root, outdir))
        return 'it is the project folder, or a folder above it';
    if (path.relative(home, outdir) === '') return 'it is the home folder';
    const inProject = PROJECT_FOLDERS.find((f) =>
        isWithin(outdir, path.join(root, f))
    );
    if (inProject) return `it is inside the project's ${inProject}/ folder`;
    if (['package.json', '.git'].some((f) => existsSync(path.join(outdir, f))))
        return 'it holds another project (package.json or .git)';
    return null;
}
