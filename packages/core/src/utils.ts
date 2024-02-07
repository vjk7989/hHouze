import { PackedGroth16Proof } from './types'
import { groth16, Groth16Proof, ZKArtifact } from 'snarkjs'
import { BigNumberish } from './types'
import { AnonAadhaarCore } from './core'
import pako from 'pako'

export const handleError = (error: unknown, defaultMessage: string): Error => {
  if (error instanceof Error) return error

  let stringified = defaultMessage
  try {
    stringified = JSON.stringify(error)
    // eslint-disable-next-line no-empty
  } catch {}

  const err = new Error(
    `This value was thrown as is, not through an Error: ${stringified}`
  )
  return err
}

export function splitToWords(
  number: bigint,
  wordsize: bigint,
  numberElement: bigint
) {
  let t = number
  const words: string[] = []
  for (let i = BigInt(0); i < numberElement; ++i) {
    const baseTwo = BigInt(2)

    words.push(`${t % BigInt(Math.pow(Number(baseTwo), Number(wordsize)))}`)
    t = BigInt(t / BigInt(Math.pow(Number(BigInt(2)), Number(wordsize))))
  }
  if (!(t == BigInt(0))) {
    throw `Number ${number} does not fit in ${(
      wordsize * numberElement
    ).toString()} bits`
  }
  return words
}

/**
 * Packs a proof into a format compatible with AnonAadhaar.sol contract.
 * @param originalProof The proof generated with SnarkJS.
 * @returns The proof compatible with Semaphore.
 */
export function packGroth16Proof(
  groth16Proof: Groth16Proof
): PackedGroth16Proof {
  return [
    groth16Proof.pi_a[0],
    groth16Proof.pi_a[1],
    groth16Proof.pi_b[0][1],
    groth16Proof.pi_b[0][0],
    groth16Proof.pi_b[1][1],
    groth16Proof.pi_b[1][0],
    groth16Proof.pi_c[0],
    groth16Proof.pi_c[1],
  ]
}

/**
 * Turn a groth16 proof into a call data format to use it as a transaction input.
 * @param input Inputs needed to generate the witness.
 * @param wasmPath Path to the wasm file.
 * @param zkeyPath Path to the zkey file.
 * @returns {a, b, c, Input} which are the input needed to verify a proof in the Verifier smart contract.
 */
export async function exportCallDataGroth16(
  input: {
    signature: string[]
    modulus: string[]
    base_message: string[]
    app_id: string
  },
  wasmPath: ZKArtifact,
  zkeyPath: ZKArtifact
): Promise<{
  a: [BigNumberish, BigNumberish]
  b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]]
  c: [BigNumberish, BigNumberish]
  Input: BigNumberish[]
}> {
  const { proof: _proof, publicSignals: _publicSignals } =
    await groth16.fullProve(input, wasmPath, zkeyPath)
  const calldata = await groth16.exportSolidityCallData(_proof, _publicSignals)

  const argv = calldata
    .replace(/["[\]\s]/g, '')
    .split(',')
    .map((x: string) => BigInt(x).toString())

  const a: [BigNumberish, BigNumberish] = [argv[0], argv[1]]
  const b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]] = [
    [argv[2], argv[3]],
    [argv[4], argv[5]],
  ]
  const c: [BigNumberish, BigNumberish] = [argv[6], argv[7]]
  const Input = []

  for (let i = 8; i < argv.length; i++) {
    Input.push(argv[i])
  }
  return { a, b, c, Input }
}

/**
 * Turn an AnonAadhaarProof into a call data format to use it as a transaction input.
 * @param _anonAadhaarProof The Core proof you want to verify on-chain.
 * @returns {a, b, c, Input} which are the input needed to verify a proof in the Verifier smart contract.
 */
export async function exportCallDataGroth16FromPCD(
  _anonAadhaarProof: AnonAadhaarCore
): Promise<{
  a: [BigNumberish, BigNumberish]
  b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]]
  c: [BigNumberish, BigNumberish]
  publicInputs: BigNumberish[]
}> {
  const calldata = await groth16.exportSolidityCallData(
    _anonAadhaarProof.proof.groth16Proof,
    [
      _anonAadhaarProof.proof.identityNullifier,
      _anonAadhaarProof.proof.userNullifier,
      _anonAadhaarProof.proof.timestamp,
      _anonAadhaarProof.proof.pubkeyHash,
      _anonAadhaarProof.proof.signalHash,
    ]
  )

  const argv = calldata
    .replace(/["[\]\s]/g, '')
    .split(',')
    .map((x: string) => BigInt(x).toString())

  const a: [BigNumberish, BigNumberish] = [argv[0], argv[1]]
  const b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish]] = [
    [argv[2], argv[3]],
    [argv[4], argv[5]],
  ]
  const c: [BigNumberish, BigNumberish] = [argv[6], argv[7]]
  const publicInputs = []

  for (let i = 8; i < argv.length; i++) {
    publicInputs.push(argv[i])
  }
  return { a, b, c, publicInputs }
}

/**
 * Fetch the public key file from the serverless function endpoint.
 * @param url Endpoint URL from where to fetch the public key.
 * @returns {Promise<string | null>} The official Aadhaar public key in bigint string format.
 *
 * See the endpoint implementation here: [Endpoint Code](https://github.com/anon-aadhaar-private/nodejs-serverless-function-express/blob/main/api/get-public-key.ts)
 */
export const fetchPublicKey = async (
  certUrl: string
): Promise<string | null> => {
  try {
    const response = await fetch(
      `https://nodejs-serverless-function-express-eight-iota.vercel.app/api/get-public-key?url=${certUrl}`
    )
    if (!response.ok) {
      throw new Error(`Failed to fetch public key from server`)
    }

    const publicKeyData = await response.json()
    return publicKeyData.publicKey || null
  } catch (error) {
    console.error('Error fetching public key:', error)
    return null
  }
}

export function convertBigIntToByteArray(bigInt: bigint) {
  const byteLength = Math.max(1, Math.ceil(bigInt.toString(2).length / 8))

  const result = new Uint8Array(byteLength)
  let i = 0
  while (bigInt > 0) {
    result[i] = Number(bigInt % BigInt(256))
    bigInt = bigInt / BigInt(256)
    i += 1
  }
  return result.reverse()
}

export function decompressByteArray(byteArray: Uint8Array) {
  const decompressedArray = pako.inflate(byteArray)
  return decompressedArray
}

export const enum SELECTOR_ID {
  null = 0,
  emailOrPhone,
  referenceId,
  name,
  dob,
  gender,
  careOf,
  district,
  landmark,
  house,
  location,
  pinCode,
  postOffice,
  state,
  street,
  subDistrict,
  VTC,
}

export function readData(data: number[], index: number) {
  let count = 0
  let start = 0
  let end = data.indexOf(255, start)

  while (count != index) {
    start = end + 1
    end = data.indexOf(255, start)
    count++
  }

  return data.slice(start, end)
}

export function extractPhoto(qrData: number[]) {
  let begin = 0
  for (let i = 0; i < 16; ++i) {
    begin = qrData.indexOf(255, begin + 1)
  }

  const end = qrData.length - 65
  return {
    begin,
    end,
    photo: qrData.slice(begin, end + 1),
  }
}