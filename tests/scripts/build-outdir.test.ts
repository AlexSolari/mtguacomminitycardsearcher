import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { unsafeOutdir } from '../../scripts/build-outdir';

const root = path.resolve('/work/cardsearcher');
const home = path.resolve('/home/me');
const check = (dir: string) => unsafeOutdir(path.resolve(dir), root, home);

describe('unsafeOutdir', () => {
    test('a build folder in the project or anywhere outside it is fine', () => {
        expect(check('/work/cardsearcher/dist')).toBeNull();
        expect(check('/work/cardsearcher/out/web')).toBeNull();
        expect(check('/work/site')).toBeNull();
        expect(check('/home/me/builds/cardsearcher')).toBeNull();
        // a name that only starts like a project folder
        expect(check('/work/cardsearcher/src-build')).toBeNull();
    });

    test('the project, or a folder above it, is refused', () => {
        for (const dir of ['/work/cardsearcher', '/work', '/'])
            expect(check(dir)).toContain('project folder');
    });

    test('the home folder is refused', () => {
        expect(check('/home/me')).toContain('home folder');
    });

    test("the project's own folders, and anything in them, are refused", () => {
        expect(check('/work/cardsearcher/src')).toContain('src/');
        expect(check('/work/cardsearcher/src/components')).toContain('src/');
        expect(check('/work/cardsearcher/tests')).toContain('tests/');
        expect(check('/work/cardsearcher/node_modules/x')).toContain(
            'node_modules/'
        );
        expect(check('/work/cardsearcher/data')).toContain('data/');
    });

    test('a folder holding another project is refused', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'outdir-'));
        try {
            expect(unsafeOutdir(dir, root, home)).toBeNull();
            writeFileSync(path.join(dir, 'package.json'), '{}');
            expect(unsafeOutdir(dir, root, home)).toContain('another project');
            rmSync(path.join(dir, 'package.json'));
            mkdirSync(path.join(dir, '.git'));
            expect(unsafeOutdir(dir, root, home)).toContain('another project');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
