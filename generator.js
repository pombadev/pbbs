import { debuglog } from "util";
import { get } from "https";
import { join } from "path";
import { marked } from "marked";
import { readFile, writeFile, stat } from "fs/promises";

const logger = debuglog("pbbs");
const raw_md_file = join("workingdir", "pure-bash-bible.md");

const Utils = {
  olderThanOneDay(time) {
    let now = new Date();
    let diff = Math.floor((now.getTime() - time.getTime()) / (1000 * 3600 * 24));

    logger("(olderThanOneDay) %d", diff);

    return diff <= 1;
  },

  async canUseCache() {
    try {
      const fileInfo = await stat(raw_md_file);

      return (
        fileInfo.isFile() && this.olderThanOneDay(fileInfo.mtime)
      );
    } catch {
      return false;
    }
  },

  async getUserAgent() {
    const [pkg, { arch, cpus, platform, type }] = await Promise.all([
      readFile("./package.json", { encoding: "utf8" }),
      import("os"),
    ]);

    const { name, version } = JSON.parse(pkg);

    const ua = `${name}/${version} (${type()}; ${platform()}) ${arch()}, ${process.version}, ${cpus().length}`;

    logger("(getUserAgent) %s", ua);

    return ua;
  },
};

function tail(it) {
  return it[it.length - 1];
}

async function fetch() {
  return new Promise(async (resolve, reject) => {
    const getLocal = await Utils.canUseCache();

    if (getLocal) {
      logger("(fetch) %s", "use local");
      const ret = await readFile(raw_md_file);
      return resolve(ret)
    }

    const ua = await Utils.getUserAgent();

    logger("(fetch) %s", "fetching from remote");
    const req = get(
      "https://raw.githubusercontent.com/dylanaraps/pure-bash-bible/master/README.md",
      { headers: { "User-Agent": ua } },
      (res) => {
        let ret = new Uint8Array(0);

        res.on("data", (d) => {
          ret = new Uint8Array([...ret, ...d]);
        });

        res.on("end", () => {
          writeFile(raw_md_file, ret).then(() => {
            logger("(fetch) %s", "done");
            resolve(ret);
          });
        });
      }
    ).on("error", reject);

    req.end();
  });
}

(async function main() {
  const data = await fetch();

  const tokens = marked.lexer(new TextDecoder().decode(data), { gfm: true });

  const parsed = tokens
    .filter((token) => {
      if (
        token.type == "html" ||
        token.text === "Table of Contents" ||
        token.text === "FOREWORD" ||
        token.text === "AFTERWORD"
      ) {
        return false;
      }

      return (
        token.type === "heading" ||
        token.type === "code" ||
        token.text?.match(/\*\*Example (Function|Usage):\*\*/)
      );
    })
    .reduce((init, token) => {
      // category
      if (token.type === "heading" && token.raw.match(/^# \S+/)) {
        init[token.text] ??= [];
      }

      let keys = Object.keys(init);

      let snippet = tail(keys);

      if (snippet) {
        let item = init[snippet];

        if (token.type === "heading" && /## \S+/.test(token.raw)) {
          item.push({
            description: token.text,
          });
        }

        let curr = tail(item);

        if (curr) {
          if (
            token.type === "paragraph" &&
            token.text.match(/Example Function/)
          ) {
            curr.example = null;
          }

          if (curr.example === null && token.type === "code") {
            curr.example = token.text;
          }

          if (token.type === "paragraph" && token.text.match(/Example Usage/)) {
            curr.usage = null;
          }

          if (curr.usage === null && token.type === "code") {
            curr.usage = token.text;
          }

          if (token.type === "code" && !token.depth) {
            curr.usage = token.text;
          }
        }
      }

      return init;
    }, {});

  const filtered = Object.keys(parsed).reduce(
    (init, key) => {
      init[key.toLowerCase()] = parsed[key].map((s) => {
        return {
          body: s.example || s.usage,
          prefix: s.description.replaceAll(" ", "_").toLowerCase(),
          description: s.description,
        };
      });

      return init;
    },
    {
      shebang: {
        prefix: "shebang",
        body: "#!/usr/bin/env ${1:bash}\n\n$0",
        description: "Add a shebang line",
      },
    }
  );

  logger("(main) %s", "writing to file");

  await writeFile(
    "./workingdir/snippets.json",
    JSON.stringify(filtered, null, 2)
  );

})()