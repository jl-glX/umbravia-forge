export function resolveNpmInvocation(args, environment = process.env) {
  const npmEntryPoint = environment.npm_execpath;
  if (!npmEntryPoint) {
    throw new Error(
      "Este control debe iniciarse mediante un script de npm para reutilizar el gestor de paquetes fijado por el proyecto.",
    );
  }

  return {
    command: process.execPath,
    args: [npmEntryPoint, ...args],
  };
}
