import { readFile } from 'fs/promises';

const temp = await readFile('workingdir/snippets.json', { encoding: 'utf8' })
const prod = await readFile('src/snippets.json', { encoding: 'utf8' })

const tempKeys = Object.keys(JSON.parse(temp))
const prodKeys = Object.keys(JSON.parse(prod))


const diff = tempKeys.filter(x => !prodKeys.includes(x))

console.log('Keys not implemented:\n%o', diff)