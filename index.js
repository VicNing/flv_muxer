const fs = require('fs');
const path = require('path');
const Buffer = require('buffer').Buffer;

const HEADER_FIELD = {
    SIGNATURE: 'signature',
    VERSION: 'version',
    TYPE_FLAGS_RESERVED: 'typeFlagsReserved',
    TYPE_FLAGS_AUDIO: 'typeFlagsAudio',
    TYPE_FLAGS_VIDEO: 'typeFlagsVideo',
    DATA_OFFSET: 'dataOffset'
};

const DATA_TYPE = {
    BITS: 'bits',
    UBIT: 'ubit',
    UINT8: 'uint8',
    UINT32: 'uint32'
};

const HEADER_SPEC = {
    0: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x46,
        desc: 'should always be \'F\'',
        length: 1,
        type: DATA_TYPE.UINT8
    },
    1: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x4c,
        desc: 'should always be \'L\'',
        length: 1,
        type: DATA_TYPE.UINT8
    },
    2: {
        field: HEADER_FIELD.SIGNATURE,
        predicate: buffer => buffer.readUInt8(0) === 0x56,
        desc: 'should always be \'V\'',
        length: 1,
        type: DATA_TYPE.UINT8
    },
    3: {
        field: HEADER_FIELD.VERSION,
        desc: 'is file version',
        length: 1,
        type: DATA_TYPE.UINT8
    },
    4: {
        desc: 'contains type flags',
        length: 1,
        type: DATA_TYPE.BITS,
        bits: {
            0: {
                field: HEADER_FIELD.TYPE_FLAGS_RESERVED,
                desc: 'must be 0',
                predicate: bits => (bits & 0b11111000) === 0,
                length: 5,
                type: DATA_TYPE.UBIT
            },
            5: {
                field: HEADER_FIELD.TYPE_FLAGS_AUDIO,
                desc: 'presents audio tags',
                // predicate: bits => bits & 0b00000100 === 1,
                length: 1,
                type: DATA_TYPE.UBIT
            },
            6: {
                field: HEADER_FIELD.TYPE_FLAGS_RESERVED,
                desc: 'must be 0',
                predicate: bits => (bits & 0b00000010) === 0,
                length: 1,
                type: DATA_TYPE.UBIT
            },
            7: {
                field: HEADER_FIELD.TYPE_FLAGS_VIDEO,
                desc: 'presents video tags',
                length: 1,
                type: DATA_TYPE.UBIT
            }

        }
    },
    5: {
        field: HEADER_FIELD.DATA_OFFSET,
        desc: 'shows offset in bytes',
        length: 1,
        type: DATA_TYPE.UINT32
    }
}

const describe = function (frame, offset, bit) {
    let describe = `it ${frame.desc} at offset ${offset} ${typeof bit === 'number' ? `in bit ${bit}` : ''}`;
    console.log(describe);
    return describe;
}

const typeLength = function (type, length) {
    let byteLength = 0;
    switch (type) {
        case DATA_TYPE.UINT8:
            byteLength = 1;
            break;
        case DATA_TYPE.UINT32:
            byteLength = 4;
            break;
        case DATA_TYPE.UBYTE:
            byteLength = 1;
            break;
        default:
            throw new Error(`typeLength doesn\'t have type ${type}`);
    }
    let totalLength = byteLength * length;
    return totalLength;
}

const sliceByteChunk = function (chunk, offset, length, type) {
    let totalLength = typeLength(type, length);
    let byteArray = [];
    for (let i = 0; i < totalLength; i++) {
        byteArray.push(chunk[offset]);
        offset++;
    }
    let slice = Buffer.from(byteArray);
    return { slice, totalLength };
}

const verifyBits = function (bits, spec, byteOffset, bitOffset) {
    if (bitOffset > 8) {
        return true;
    }

    let frame = spec[0];
    if (frame) {
        if (frame.predicate) {
            return frame.predicate(bits) ? describe(frame, byteOffset, bitOffset) && verifyBits(bits, spec, byteOffset, ++bitOffset) : false;
        } else {
            return describe(frame, byteOffset, bitOffset) && verifyBits(bits, spec, byteOffset, ++bitOffset);
        }
    } else {
        return false;
    }
}

const demuxFlvHeader = function (chunk, offset) {
    let frame = HEADER_SPEC[offset];
    if (frame) {
        if (frame.type === DATA_TYPE.BITS && verifyBits(chunk[offset], frame.bits, offset, 0)) {
            demuxFlvHeader(chunk, offset + 1);
        }
        else if (frame.predicate) {
            let sliceBundle = sliceByteChunk(chunk, offset, frame.length, frame.type);
            if (frame.predicate(sliceBundle.slice)) {
                console.log(`it ${frame.desc} at offset ${offset}`);
                demuxFlvHeader(chunk, offset + sliceBundle.totalLength);
            } else {
                throw new Error(`invalid header field at offset ${offset}, it ${frame.desc}`);
            }
        }
        else {
            console.log(`it ${frame.desc} at offset ${offset}`);
            demuxFlvHeader(chunk, offset + typeLength(frame.type, frame.length));
        }
    } else {
        throw new Error(`header frame at ${offset} doesn\'t exist!`)
    }


}

const readStream = function () {
    let offset = 0,
        chunkPosition = 0
    return function (chunk) {
        if (chunkPosition === 0) {
            demuxFlvHeader(chunk, offset)
        } else {

        }
        chunkPosition += chunk.length
    }
}

let stream = fs.createReadStream(path.resolve(__dirname, 'videos', 'sample.flv'))
stream.on('data', readStream())
stream.on('error', err => { throw err })


