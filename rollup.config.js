import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
    input: 'node_modules/pdf-lib/es/index.js',

    output: {
        file: 'build/assets/lib/pdf-lib.js',
        format: 'amd',
        amd: {
            id: 'pdf-lib'
        }
    },

    plugins: [
        nodeResolve({
            browser: true
        }),
        commonjs(),
        json()
    ]
};
