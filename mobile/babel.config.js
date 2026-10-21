// sleeperStandings (Node ESM) reads `import.meta.url` only to build cache-file paths next to its
// own files. Hermes can't parse `import.meta`, and the phone has no such files (shims/fs keeps
// that cache in memory), so any constant path will do.
function importMetaUrl({ types: t }) {
  return {
    visitor: {
      MetaProperty(p) {
        if (p.node.meta.name === 'import' && p.node.property.name === 'meta')
          p.replaceWith(t.objectExpression([t.objectProperty(t.identifier('url'), t.stringLiteral('file:///sleeper-standings/dist/module.js'))]))
      },
    },
  }
}

module.exports = function (api) {
  api.cache(true)
  return { presets: ['babel-preset-expo'], plugins: [importMetaUrl] }
}
