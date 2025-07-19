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

export function generateSettingFile(tree, originalContent, originalFilename, groupOperatorName, originalTools) {
    const HELPER_NODE_NAME = "background_helper";
    const userControls = [];
    const userControlInputs = [];
    const mainInputs = [];
    let autoLabelCounter = 1;

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
            return node.data.originalBlock;
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
            return `                ${node.data.key || internalKey} = InstanceInput {\n                    SourceOp = "${HELPER_NODE_NAME}",\n                    Source = "${internalKey}"\n                }`;
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
    const newInputsBlock = `Inputs = ordered() {\n${sanitizedMainInputs.join(',\n')}\n            }`;

    const newHelperNode = `                ${HELPER_NODE_NAME} = Background {
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
    if (cleanedTools.trim()) {
        // Only add a comma if there are other tools to follow
        newToolsBlockContent += cleanedTools.trim();
    }
    const newToolsBlock = `Tools = ordered() {\n${newToolsBlockContent}\n            }`;

    const outputsBlockInfo = findBlockContent(originalContent, "Outputs = {", originalContent.indexOf(groupOperatorName));
    const viewInfoBlockInfo = findBlockContent(originalContent, "ViewInfo = GroupInfo {", originalContent.indexOf(groupOperatorName));
    if (!outputsBlockInfo || !viewInfoBlockInfo) throw new Error("Could not find 'Outputs' or 'ViewInfo' blocks.");

    const outputsBlockString = originalContent.substring(outputsBlockInfo.startIndex, outputsBlockInfo.endIndex);
    const viewInfoBlockString = originalContent.substring(viewInfoBlockInfo.startIndex, viewInfoBlockInfo.endIndex);

    const groupOperatorParts = [
        newInputsBlock.trim(),
        outputsBlockString.trim(),
        viewInfoBlockString.trim(),
        newToolsBlock.trim()
    ];
    const newGroupOperatorContent = `\n            ${groupOperatorParts.join(',\n            ')}\n        `;

    const finalContent = `{
    Tools = ordered() {
        ${groupOperatorName} = GroupOperator {${newGroupOperatorContent}}
    },
    ActiveTool = "${groupOperatorName}"
}`;

    const safeFilename = String(originalFilename || 'macro.setting');
    const newFilename = safeFilename.replace('.setting', '_modified.setting');

    return { content: finalContent, filename: newFilename };
}
