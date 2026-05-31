package dev.goblin.android.domain.ssh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PortForwardModelsTest {
    @Test
    fun `request defaults to remote loopback and automatic local port`() {
        val request = PortForwardRequest.create(remotePort = 3000)

        assertEquals("127.0.0.1", request.remoteHost)
        assertEquals(3000, request.remotePort)
        assertEquals("127.0.0.1", request.localHost)
        assertEquals(0, request.localPort)
    }

    @Test
    fun `local forwarded url uses loopback and assigned local port`() {
        assertEquals("http://127.0.0.1:49152", forwardedLocalUrl(localPort = 49152))
    }

    @Test
    fun `remote port must be valid tcp port`() {
        assertFalse(canCreatePortForward(remotePort = "", localPort = ""))
        assertFalse(canCreatePortForward(remotePort = "0", localPort = ""))
        assertFalse(canCreatePortForward(remotePort = "65536", localPort = ""))
        assertFalse(canCreatePortForward(remotePort = "abc", localPort = ""))
        assertTrue(canCreatePortForward(remotePort = "3000", localPort = ""))
    }

    @Test
    fun `local port allows blank automatic allocation or valid tcp port`() {
        assertTrue(canCreatePortForward(remotePort = "3000", localPort = ""))
        assertTrue(canCreatePortForward(remotePort = "3000", localPort = "49152"))
        assertFalse(canCreatePortForward(remotePort = "3000", localPort = "0"))
        assertFalse(canCreatePortForward(remotePort = "3000", localPort = "65536"))
        assertFalse(canCreatePortForward(remotePort = "3000", localPort = "abc"))
    }

    @Test
    fun `port forward request parses user input`() {
        val request = PortForwardRequest.fromInput(remotePort = " 8080 ", localPort = " 49152 ")

        assertEquals(8080, request.remotePort)
        assertEquals(49152, request.localPort)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `explicit local port input rejects zero`() {
        PortForwardRequest.fromInput(remotePort = "8080", localPort = "0")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `request rejects blank remote service host`() {
        PortForwardRequest.create(remoteHost = "", remotePort = 3000)
    }
}
