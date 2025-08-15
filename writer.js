// writer.js

function findBlockContent(content, blockStartMarker, startIndex = 0) {
    const startMarkerIndex = content.indexOf(blockStartMarker, startIndex);
    if (startMarkerIndex === -1) return null;

    const blockContentStartIndex = startMarkerIndex + blockStartMarker.length;
    let braceDepth = 1;
    let blockEndIndex = -1;

    for (let i = blockContentStartIndex; i < content.length; i++) {
        if (content[i] === '{') braceDepth++;
        else if (content[i] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
                blockEndIndex = i;
                break;
            }
        }
    }
    if (blockEndIndex === -1) return null;

    return {
        content: content.substring(blockContentStartIndex, blockEndIndex),
        startIndex: startMarkerIndex,
        endIndex: blockEndIndex + 1
    };
}

function findTopLevelBlock(body, header) {
    if (!body) return null;
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);

        if (depth === 0 && body.startsWith(header, i)) {
            const bracePos = body.indexOf('{', i + header.length - 1);
            if (bracePos === -1) return null;
            let d = 1;
            let j = bracePos + 1;
            while (j < body.length && d > 0) {
                const cj = body[j];
                if (cj === '{') d++;
                else if (cj === '}') d--;
                j++;
            }
            if (d === 0) {
                return {
                    content: body.substring(bracePos + 1, j - 1),
                    startIndex: i,
                    endIndex: j
                };
            } else {
                return null;
            }
        }
    }
    return null;
}

function findFirstTopLevelBlock(body, headers) {
    for (const h of headers) {
        const blk = findTopLevelBlock(body, h);
        if (blk) return blk;
    }
    return null;
}

function indentLines(text, indent = "                ") {
    return text
        .split("\n")
        .map(line => indent + line)
        .join("\n");
}

function indentFirstLine(text, indent = "                ") {
    const nl = text.indexOf("\n");
    if (nl === -1) return indent + text;
    const first = text.slice(0, nl);
    const rest = text.slice(nl + 1);
    return indent + first + "\n" + rest;
}

function updateInstanceInputName(block, newName) {
    try {
        const escaped = String(newName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        // Try to replace existing Name property (keep existing indentation and trailing comma)
        const namePropRegex = /(\n[ \t]*Name\s*=\s*)("([^"]*)"|[^,}\n]+)(\s*,?)/;
        if (namePropRegex.test(block)) {
            return block.replace(namePropRegex, `$1"${escaped}",`);
        }

        // Otherwise insert Name as the first property after the opening brace
        const braceIdx = block.indexOf('{');
        if (braceIdx === -1) return block;

        const newlineIdx = block.indexOf('\n', braceIdx);
        const insertPos = newlineIdx === -1 ? braceIdx + 1 : newlineIdx + 1;

        const after = block.slice(insertPos);
        // Try to infer indentation from the next line; fallback to 20 spaces if not found
        const indentMatch = after.match(/^([ \t]+)/);
        const indent = indentMatch ? indentMatch[1] : '                    ';

        const insertion = `${indent}Name = "${escaped}",\n`;
        return block.slice(0, insertPos) + insertion + block.slice(insertPos);
    } catch {
        return block;
    }
}

export function generateSettingFile(tree, originalContent, originalFilename, mainOperatorName, mainOperatorType, originalTools, maxAutoLabelIndex = 0) {
    const HELPER_NODE_NAME = "background_helper";
    const userControls = [];
    const userControlInputs = [];
    const mainInputs = [];
    // Determine the highest existing AutoLabel index from both the parsed file and the current in-memory tree
    let maxFromTree = 0;
    (function scan(node) {
        if (node && node.type === 'GROUP' && node.internalKey) {
            const m = String(node.internalKey).match(/^AutoLabel(\d+)$/);
            if (m) {
                const n = parseInt(m[1], 10);
                if (!isNaN(n)) maxFromTree = Math.max(maxFromTree, n);
            }
        }
        if (node && node.children) node.children.forEach(scan);
    })(tree);
    const effectiveMax = Math.max(maxAutoLabelIndex || 0, maxFromTree || 0);
    let autoLabelCounter = effectiveMax + 1;

    function getDepth(node) {
        let depth = 0;
        let current = node.parent;
        while(current && current.type !== 'ROOT') {
            if(current.type === 'GROUP') depth++;
            current = current.parent;
        }
        return depth;
    }

    function addPageProperty(textBlock, pageName) {
        if (!pageName) return textBlock;
        if (textBlock.includes('Page = ')) {
            return textBlock.replace(/Page\s*=\s*"[^"]*"/, `Page = "${pageName}"`);
        } else {
            return textBlock.replace(/(\s*{)/, `$1\n                    Page = "${pageName}",`);
        }
    }

    function generateBaseBlock(node) {
        if (node.type === 'CONTROL') {
            let block = node.data.originalBlock;
            // If this control was renamed via UI, reflect it into the InstanceInput block as Name
            if (node.data && node.data.__renamed) {
                const newName = node.data.properties ? node.data.properties.Name : null;
                if (newName && typeof newName === 'string') {
                    block = updateInstanceInputName(block, newName);
                }
            }
            return block;
        }
        else if (node.type === 'GROUP') {
            if (!node.internalKey) {
                node.internalKey = `AutoLabel${autoLabelCounter++}`;
            }
            const internalKey = node.internalKey;
            let descendantCount = 0;
            function countDescendants(n) {
                n.children.forEach(child => {
                    descendantCount++;
                    if (child.type === 'GROUP') countDescendants(child);
                });
            }
            countDescendants(node);
            userControls.push(`                        ${internalKey} = { LBLC_DropDownButton = true, INPID_InputControl = "LabelControl", LBLC_NumInputs = ${descendantCount}, LBLC_NestLevel = ${getDepth(node) + 1}, LINKID_DataType = "Number", LINKS_Name = "${node.name}", },`);
            userControlInputs.push(`                        ${internalKey} = Input { Value = 1, },`);
            return `                ${node.data?.key || internalKey} = InstanceInput {\n                    SourceOp = "${HELPER_NODE_NAME}",\n                    Source = "${internalKey}"\n                }`;
        }
        return '';
    }

    const flatList = (function flatten(node) {
        let list = [];
        if (node.type !== 'ROOT') { list.push(node); }
        if (node.children) { node.children.forEach(child => { list = list.concat(flatten(child)); }); }
        return list;
    })(tree);

    for (let i = 0; i < flatList.length; i++) {
        const item = flatList[i];
        if (item.type === 'PAGE') {
            mainInputs.push(`\n                -- ▼▼▼ ページ: ${item.name} ▼▼▼`);
            const nextItem = flatList[i + 1];
            if (nextItem && (nextItem.type === 'CONTROL' || nextItem.type === 'GROUP')) {
                const baseBlock = generateBaseBlock(nextItem);
                const finalBlock = addPageProperty(baseBlock, item.name);
                mainInputs.push(finalBlock);
                i++;
            }
        } else {
            const baseBlock = generateBaseBlock(item);
            mainInputs.push(baseBlock);
        }
    }

    const sanitizedMainInputs = mainInputs.map(block => block.trim().replace(/,$/, "").trim());
    const indentedMainInputs = sanitizedMainInputs.map(b => indentFirstLine(b, "                "));
    const newInputsBlock = `Inputs = ordered() {\n${indentedMainInputs.join(',\n')}\n            }`;

    const newHelperNode = `                ${HELPER_NODE_NAME} = Background {
                    PassThrough = true,
                    Inputs = {
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
${userControlInputs.join('\n')}
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, -100 } },
                    UserControls = ordered() {
${userControls.join('\n')}
                    }
                }`

    let cleanedTools = originalTools;
    const helperBlockInfo = findBlockContent(originalTools, `${HELPER_NODE_NAME} = Background {`);
    if (helperBlockInfo) {
        cleanedTools = originalTools.substring(0, helperBlockInfo.startIndex) + originalTools.substring(helperBlockInfo.endIndex);
    }

    // 3. Assemble the Tools block with explicit, controlled comma placement
    let newToolsBlockContent = newHelperNode;

    // cleanedToolsに中身がある場合のみ処理
    if (cleanedTools.trim()) {
        // 先頭の空白・カンマだけを除去（内部の既存インデントは保持）
        const cleanedHead = cleanedTools.replace(/^[\s,]*/, '');
        // 次行の先頭（最初の行）だけ Tools レベルのインデントを付与
        const indentedHeadOnce = indentFirstLine(cleanedHead, "                ");
        // 確実にカンマを1つだけ追加して結合する
        newToolsBlockContent += ',\n' + indentedHeadOnce;
    }

    const newToolsBlock = `Tools = ordered() {\n${newToolsBlockContent}\n            }`;

    const mainHeader = `${mainOperatorName} = ${mainOperatorType} {`;
    const mainHeaderIndex = originalContent.indexOf(mainHeader);
    const groupBlockInfo = findBlockContent(originalContent, mainHeader, Math.max(0, mainHeaderIndex));
    const groupBody = groupBlockInfo ? groupBlockInfo.content : originalContent;

    const outputsBlockInfo = findFirstTopLevelBlock(groupBody, ["Outputs = ordered() {", "Outputs = {"]);
    const viewInfoBlockInfo = findFirstTopLevelBlock(groupBody, ["ViewInfo = GroupInfo {", "ViewInfo = OperatorInfo {"]);

    if (!outputsBlockInfo || !viewInfoBlockInfo) throw new Error("Could not find 'Outputs' or 'ViewInfo' blocks within the main operator.");

    const outputsBlockString = groupBody.substring(outputsBlockInfo.startIndex, outputsBlockInfo.endIndex);
    const viewInfoBlockString = groupBody.substring(viewInfoBlockInfo.startIndex, viewInfoBlockInfo.endIndex);

    const groupOperatorParts = [
        newInputsBlock.trim(),
        outputsBlockString.trim(),
        viewInfoBlockString.trim(),
        newToolsBlock.trim()
    ];
    const newGroupOperatorContent = `\n            ${groupOperatorParts.join(',\n            ')}\n        `;

    const finalContent = `{
    Tools = ordered() {
        ${mainOperatorName} = ${mainOperatorType} {${newGroupOperatorContent}}
    },
    ActiveTool = "${mainOperatorName}"
}`;

    const safeFilename = String(originalFilename || 'macro.setting');
    const newFilename = safeFilename.replace('.setting', '_modified.setting');

    return { content: finalContent, filename: newFilename };
}
