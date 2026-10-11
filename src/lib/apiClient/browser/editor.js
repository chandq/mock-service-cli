const { EditorView, lineNumbers, keymap, highlightActiveLine } = require('@codemirror/view');
const { EditorState } = require('@codemirror/state');
const { defaultKeymap, history, historyKeymap } = require('@codemirror/commands');
const { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter } = require('@codemirror/language');
const { json } = require('@codemirror/lang-json');
window.createApiEditor = (parent, value, onChange, isJson) => {
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        foldGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        ...(isJson ? [json()] : []),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { color: 'var(--text)', backgroundColor: 'var(--surface)' },
          '.cm-activeLine': { backgroundColor: 'var(--subtle)' }
        })
      ]
    })
  });
  return { destroy: () => editor.destroy(), focus: () => editor.focus() };
};
