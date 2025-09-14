// writer.js

/**
 * A utility to update the 'Name' property within an InstanceInput block string.
 * @param {string} block The original InstanceInput block string.
 * @param {string} newName The new name to set.
 * @returns {string} The updated block string.
 */
function updateInstanceInputName(block, newName) {
    try {
        const escaped = String(newName).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        // Regex to find and replace an existing Name property
        const namePropRegex = /(\n[ \t]*Name\s*=\s*)("([^"]*)"|[^,}\n]+)(\s*,?)/;
        if (namePropRegex.test(block)) {
            return block.replace(namePropRegex, `$1"${escaped}",`);
        }

        // If Name property doesn't exist, add it after the opening brace.
        const braceIdx = block.indexOf('{');
        if (braceIdx === -1) return block;

        const newlineIdx = block.indexOf('\n', braceIdx);
        const insertPos = newlineIdx === -1 ? braceIdx + 1 : newlineIdx + 1;
        const after = block.slice(insertPos);
        const indentMatch = after.match(/^([ \t]+)/);
        const indent = indentMatch ? indentMatch[1] : '                    '; // Default indent
        const insertion = `${indent}Name = "${escaped}",\n`;
        return block.slice(0, insertPos) + insertion + block.slice(insertPos);
    } catch {
        return block; // Return original block on error
    }
}

/**
 * A utility to add or update the 'Page' property within an InstanceInput block string.
 * @param {string} textBlock The original InstanceInput block string.
 * @param {string} pageName The page name to set.
 * @returns {string} The updated block string.
 */
function addPageProperty(textBlock, pageName) {
    if (!pageName) return textBlock;
    const pageRegex = /Page\s*=\s*(?:"[^"]*"|[^,}\s]+)/;
    const escapedPageName = `"${pageName.replace(/"/g, '\\"')}"`;

    if (textBlock.match(pageRegex)) {
        return textBlock.replace(pageRegex, `Page = ${escapedPageName}`);
    } else {
        // Add the Page property after the opening brace.
        return textBlock.replace(/(\s*{)/, `$1\n                    Page = ${escapedPageName},`);
    }
}


/**
 * Generates the new .setting file content by rebuilding from the UI tree and segments.
 * @param {object} tree The hierarchical representation of the UI controls.
 * @param {Array<object>} segments The linear list of file segments from the parser.
 * @param {string} originalFilename The original filename, used to create the new filename.
 * @param {number} maxAutoLabelIndex The highest index for auto-generated labels, for collision avoidance.
 * @returns {{content: string, filename: string}}
 */
export function generateSettingFile(tree, segments, originalFilename, maxAutoLabelIndex = 0) {
    const HELPER_NODE_NAME = "background_helper";
    const userControlsForHelper = [];
    const userControlInputsForHelper = [];
    const mainInstanceInputs = [];
    let separatorCounter = 1;

    // Ensure autoLabelCounter starts from a safe number
    let autoLabelCounter = maxAutoLabelIndex + 1;

    // --- Part 1: Generate new block content from the tree ---

    function generateBlocksRecursive(node, currentPageName = null) {
        if (node.type === 'PAGE') {
            currentPageName = node.name;
        } else if (node.type !== 'ROOT') {
            let block = '';
            if (node.type === 'CONTROL') {
                block = node.data.originalBlock;
                // Apply rename if it was flagged
                if (node.data.__renamed) {
                    const newName = node.data.properties ? node.data.properties.Name : null;
                    if (newName && typeof newName === 'string') {
                        block = updateInstanceInputName(block, newName);
                    }
                }
            } else if (node.type === 'GROUP') {
                // Ensure every group has a unique internal key
                if (!node.internalKey) {
                    node.internalKey = `AutoLabel${autoLabelCounter++}`;
                }
                const descendantCount = (function count(n) {
                    return n.children.reduce((acc, child) => acc + 1 + count(child), 0);
                })(node);

                userControlsForHelper.push(`                        ${node.internalKey} = { INP_Passive = true, INP_External = false, LBLC_DropDownButton = true, INPID_InputControl = "LabelControl", LBLC_NumInputs = ${descendantCount}, LBLC_NestLevel = 1, LINKID_DataType = "Number", LINKS_Name = "${node.name}", },`);
                userControlInputsForHelper.push(`                        ${node.internalKey} = Input { Value = 1, },`);
                block = `${node.data?.key || node.internalKey} = InstanceInput {\n                    SourceOp = "${HELPER_NODE_NAME}",\n                    Source = "${node.internalKey}"\n                }`;
            } else if (node.type === 'SEPARATOR') {
                block = `${node.data.key || `Separator${separatorCounter++}`} = InstanceInput {\n                    SourceOp = "${HELPER_NODE_NAME}",\n                    Source = "Separator"\n                }`;
            }

            // Apply page property if currently inside a page
            if (currentPageName && block) {
                block = addPageProperty(block, currentPageName);
            }
            mainInstanceInputs.push(block);
        }

        // Recurse through children
        if (node.children) {
            node.children.forEach(child => generateBlocksRecursive(child, currentPageName));
        }
    }

    generateBlocksRecursive(tree);

    // Assemble the new Inputs block content
    const newInputsContent = `\n                ${mainInstanceInputs.join(',\n                ')}\n            `;

    // Assemble the new helper node content
    const newHelperContent = `
                    PassThrough = true,
                    Inputs = {
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
${userControlInputsForHelper.join('\n')}
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, -100 } },
                    UserControls = ordered() {
						Separator = { INPID_InputControl = "SeparatorControl", },
${userControlsForHelper.join('\n')}
                    }
                `;

    // --- Part 2: Reconstruct the final file from segments ---

    let rebuiltString = '';
    for (const segment of segments) {
        if (segment.type === 'inputs_block') {
            // Replace the old inputs block with the newly generated one
            rebuiltString += `\n            Inputs = ordered() {${newInputsContent}},`;
        } else if (segment.type === 'helper_block') {
            // This case handles when a helper node needs to be created from scratch
            rebuiltString += `\n                ${HELPER_NODE_NAME} = Background {${newHelperContent}},`;
        } else {
            // For all other parts of the file, append them as-is
            rebuiltString += segment.string;
        }
    }

    const formattedString  = rebuiltString.replace(/ {4}/g, '\t');
    const newFilename = (originalFilename || 'macro.setting').replace('.setting', '_modified.setting');

    return { string: formattedString , filename: newFilename };
}
