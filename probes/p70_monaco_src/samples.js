// Synthetic source files for the editor probes P70 to P75. Each language has a small block that is repeated
// with a running number, so the files are deterministic and contain the constructs a highlighter has to handle.

const BLOCKS = {
  typescript: (n) => `/** Block ${n}: a class with generics, a template string and a regular expression. */
export interface Item${n}<T extends object> { readonly id: string; readonly value: T; tags?: string[] }
export class Store${n}<T extends object> {
  private readonly items = new Map<string, Item${n}<T>>();
  constructor(private readonly limit = ${n} * 2) {}
  put(item: Item${n}<T>): void {
    if (this.items.size >= this.limit) throw new Error(\`full at \${this.limit} (block ${n})\`);
    this.items.set(item.id, item);
  }
  find(pattern = /^[a-z]+-${n}$/u): Item${n}<T>[] {
    return [...this.items.values()].filter((item) => pattern.test(item.id)); // keep order
  }
}
`,
  kotlin: (n) => `/** Block ${n}: a data class, a when expression and a string template. */
data class Item${n}(val id: String, val value: Int, val tags: List<String> = emptyList())
class Store${n}(private val limit: Int = ${n} * 2) {
    private val items = mutableMapOf<String, Item${n}>()
    fun put(item: Item${n}) {
        require(items.size < limit) { "full at \${limit} (block ${n})" }
        items[item.id] = item
    }
    fun describe(item: Item${n}): String = when {
        item.value > 100 -> "large \${item.id}"
        item.tags.isEmpty() -> "plain"
        else -> "tagged"
    }
}
`,
  rust: (n) => `/// Block ${n}: a struct, an impl with lifetimes, a match and a macro.
#[derive(Debug, Clone)]
pub struct Item${n}<'a> { pub id: &'a str, pub value: u64, pub tags: Vec<String> }
impl<'a> Item${n}<'a> {
    pub fn describe(&self) -> String {
        match self.value {
            0 => String::from("empty"),
            v if v > 100 => format!("large {} (block ${n})", self.id),
            _ => self.tags.join(", "),
        }
    }
}
`,
  java: (n) => `/** Block ${n}: a record, a switch expression and a text block. */
record Item${n}(String id, int value, java.util.List<String> tags) {}
final class Store${n} {
    private final java.util.Map<String, Item${n}> items = new java.util.HashMap<>();
    String describe(Item${n} item) {
        return switch (item.value()) {
            case 0 -> "empty";
            default -> item.value() > 100 ? "large " + item.id() : String.join(", ", item.tags());
        };
    }
    static final String TEXT = """
        block ${n}
        """;
}
`,
  python: (n) => `# Block ${n}: a dataclass, an f-string, a comprehension and a decorator.
@dataclass(frozen=True)
class Item${n}:
    id: str
    value: int = ${n}
    tags: tuple[str, ...] = ()

    def describe(self) -> str:
        if self.value > 100:
            return f"large {self.id} (block ${n})"
        return ", ".join(tag.upper() for tag in self.tags if tag)
`,
  json: (n) => `  "item${n}": { "id": "item-${n}", "value": ${n}, "enabled": ${n % 2 === 0}, "tags": ["a", "b"], "nested": { "ratio": ${n}.5, "none": null } },
`,
  yaml: (n) => `item${n}:
  id: "item-${n}"
  value: ${n}
  enabled: ${n % 2 === 0}
  tags: [a, b]   # inline list
  script: |
    echo "block ${n}"
`,
  markdown: (n) => `## Section ${n}

Some *emphasis*, some **strong text**, \`code\` and a [link](https://example.invalid/${n}).

- [ ] an open task ${n}
- [x] a done task

\`\`\`ts
const value${n} = ${n};
\`\`\`

`,
  shell: (n) => `# Block ${n}: a function, a loop, a here-document and parameter expansion.
describe_${n}() {
  local name="\${1:-item-${n}}"
  for file in ./*.txt; do
    [ -f "$file" ] && printf '%s %s\\n' "$name" "$(wc -l < "$file")"
  done
  cat <<EOF
block ${n}
EOF
}
`,
};

const WRAP = { json: (body) => `{\n${body}  "end": true\n}\n` };

/** A file of the language with at least `lines` lines. */
export function sample(language, lines) {
  const block = BLOCKS[language];
  let text = '';
  let n = 0;
  while (text.split('\n').length < lines) text += block(n++);
  return WRAP[language] ? WRAP[language](text) : text;
}

export const LANGUAGES = Object.keys(BLOCKS);

/** A copy of `text` with `edits` spread over it: changed, inserted and removed lines in turn. */
export function mutate(text, edits) {
  const lines = text.split('\n');
  const step = Math.max(3, Math.floor(lines.length / (edits + 1)));
  for (let index = edits - 1; index >= 0; index -= 1) {
    const at = (index + 1) * step;
    if (at >= lines.length) continue;
    if (index % 3 === 0) lines[at] = `${lines[at]} // changed ${index}`;
    else if (index % 3 === 1) lines.splice(at, 0, `// inserted ${index}`, `// inserted ${index} again`);
    else lines.splice(at, 1);
  }
  return lines.join('\n');
}
