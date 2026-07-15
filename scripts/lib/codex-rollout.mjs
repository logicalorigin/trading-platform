function quotedEnd(source, start) {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index + 1;
  }
  return -1;
}

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
    } else if (source.startsWith("//", index)) {
      index = source.indexOf("\n", index + 2);
      if (index === -1) return source.length;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return source.length;
      index = end + 2;
    } else {
      break;
    }
  }
  return index;
}

function callEnd(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = quotedEnd(source, index);
      if (end === -1) return -1;
      index = end - 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) return -1;
      index = end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

function valueEnd(source, start) {
  const closing = { "(": ")", "[": "]", "{": "}" };
  const stack = [];
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = quotedEnd(source, index);
      if (end === -1) return -1;
      index = end - 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      if (end === -1) return source.length;
      index = end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) return -1;
      index = end + 1;
      continue;
    }
    if (closing[char]) stack.push(closing[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (stack.length === 0 && (char === "," || char === "}")) return index;
  }
  return source.length;
}

function literalCommand(argumentSource) {
  // ponytail: accept only a literal object/string; use a real JS parser if Codex stops emitting this shape.
  let index = skipTrivia(argumentSource, 0);
  if (argumentSource[index] !== "{") return null;
  index += 1;
  let command = null;

  while (index < argumentSource.length) {
    index = skipTrivia(argumentSource, index);
    if (argumentSource[index] === "}") {
      return skipTrivia(argumentSource, index + 1) === argumentSource.length
        ? command
        : null;
    }

    let key;
    if (argumentSource[index] === '"') {
      const end = quotedEnd(argumentSource, index);
      if (end === -1) return null;
      try {
        key = JSON.parse(argumentSource.slice(index, end));
      } catch {
        return null;
      }
      index = end;
    } else {
      const match = argumentSource.slice(index).match(/^[A-Za-z_$][\w$]*/);
      if (!match) return null;
      key = match[0];
      index += match[0].length;
    }

    index = skipTrivia(argumentSource, index);
    if (argumentSource[index] !== ":") return null;
    index = skipTrivia(argumentSource, index + 1);

    if (key === "cmd") {
      if (command !== null || argumentSource[index] !== '"') return null;
      const end = quotedEnd(argumentSource, index);
      if (end === -1) return null;
      try {
        command = JSON.parse(argumentSource.slice(index, end));
        if (typeof command !== "string") return null;
      } catch {
        return null;
      }
      index = end;
    }

    index = valueEnd(argumentSource, index);
    if (index === -1 || index >= argumentSource.length) return null;
    if (argumentSource[index] === ",") index += 1;
  }
  return null;
}

export function extractCustomExecCommands(input) {
  if (typeof input !== "string") return { commands: [], unknownInvocations: 0 };

  const commands = [];
  let unknownInvocations = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"' || char === "'" || char === "`") {
      const end = quotedEnd(input, index);
      if (end === -1) break;
      index = end - 1;
      continue;
    }
    if (input.startsWith("//", index)) {
      const end = input.indexOf("\n", index + 2);
      if (end === -1) break;
      index = end;
      continue;
    }
    if (input.startsWith("/*", index)) {
      const end = input.indexOf("*/", index + 2);
      if (end === -1) break;
      index = end + 1;
      continue;
    }
    if (!input.startsWith("tools.exec_command", index)) continue;
    if (
      /[\w$]/.test(input[index - 1] ?? "") ||
      /[\w$]/.test(input[index + 18] ?? "")
    ) {
      continue;
    }

    const open = skipTrivia(input, index + 18);
    const end = input[open] === "(" ? callEnd(input, open) : -1;
    if (end === -1) {
      unknownInvocations += 1;
      continue;
    }

    const command = literalCommand(input.slice(open + 1, end));
    if (command === null) unknownInvocations += 1;
    else commands.push(command);
    index = end;
  }

  return { commands, unknownInvocations };
}

export function textFromCodexValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(textFromCodexValue).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  for (const key of ["text", "content", "output", "message"]) {
    const text = textFromCodexValue(value[key]);
    if (text) return text;
  }
  return "";
}
