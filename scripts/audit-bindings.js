import ts from 'typescript';
import {resolve} from 'node:path';

/** Check runtime identifier bindings using TypeScript's lexical scopes and standard JS/browser globals.
 * Generated strings and dynamic property names are outside this check's coverage. */
export function auditBindings(files) {
    const sources = new Map([...files].map(([file, text]) => [resolve(file).replaceAll('\\', '/'), text]));
    const options = {allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext, moduleDetection: ts.ModuleDetectionKind.Force, moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'], skipLibCheck: true};
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
    const normalize = path => resolve(path).replaceAll('\\', '/');
    host.readFile = path => sources.get(normalize(path)) ?? read(path);
    host.fileExists = path => sources.has(normalize(path)) || exists(path);
    const program = ts.createProgram([...sources.keys()], options, host), problems = [];
    for (const [file] of files) {
        const source = program.getSourceFile(normalize(file));
        for (const diagnostic of program.getSemanticDiagnostics(source)) {
            if (![2304, 2552, 18004, 2693].includes(diagnostic.code)) continue;
            let token = ts.getTokenAtPosition(source, diagnostic.start), typeOnly = false;
            for (let node = token; node; node = node.parent) {
                if (ts.isTypeNode(node) || (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode)) typeOnly = true;
            }
            if (typeOnly || (token.parent && ts.isTypeOfExpression(token.parent))) continue;
            const position = source.getLineAndCharacterOfPosition(diagnostic.start);
            problems.push({file, kind: 'undefined-variable', detail: `${position.line + 1}:${position.character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`});
        }
    }
    return {problems};
}
